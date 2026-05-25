import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { optimizeAgentPrompt, type OptimizedPrompt } from './promptOptimizer';
import type { Task, TaskStage } from './taskManager';
import type { KnowledgeResult } from './knowledgeBase';
import { contextHistory } from './contextHistory';

export interface AgentConfig {
  type: 'claude' | 'codex' | 'custom';
  customCommand?: string;
}

export interface AgentKeyInfo {
  type: 'file_write' | 'completion' | 'error' | 'thinking';
  message: string;
  detail?: string;
}

export interface AgentSession {
  sessionId: string;
  taskId: string;
  task: Task;
  stage: TaskStage;
  optimizedPrompt: OptimizedPrompt;
  isRunning: boolean;
  agentType: string;
  customCommand?: string;
}

interface AgentOutputEvent {
  task_id: string;
  data: string;
}

interface AgentThinkingEvent {
  task_id: string;
  data: string;
}

interface AgentExitEvent {
  task_id: string;
  code: number;
}

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface TaskSessionState {
  session: AgentSession;
  messageHistory: HistoryMessage[];
  currentOutputBuffer: string;
  currentThinkingBuffer: string;
  unlistenOutput: UnlistenFn | null;
  unlistenThinking: UnlistenFn | null;
  unlistenExit: UnlistenFn | null;
}

export class AgentRunner {
  private sessions: Map<string, TaskSessionState> = new Map();
  private onOutputCallback: ((taskId: string, data: string) => void) | null = null;
  private onThinkingCallback: ((taskId: string, data: string) => void) | null = null;
  private onKeyInfoCallback: ((taskId: string, info: AgentKeyInfo) => void) | null = null;
  private onExitCallback: ((taskId: string, code: number) => void) | null = null;

  onOutput(callback: (taskId: string, data: string) => void): void {
    this.onOutputCallback = callback;
  }

  onThinking(callback: (taskId: string, data: string) => void): void {
    this.onThinkingCallback = callback;
  }

  onKeyInfo(callback: (taskId: string, info: AgentKeyInfo) => void): void {
    this.onKeyInfoCallback = callback;
  }

  onExit(callback: (taskId: string, code: number) => void): void {
    this.onExitCallback = callback;
  }

  getSession(taskId: string): AgentSession | null {
    return this.sessions.get(taskId)?.session ?? null;
  }

  isTaskRunning(taskId: string): boolean {
    return this.sessions.get(taskId)?.session.isRunning ?? false;
  }

  getRunningTaskIds(): string[] {
    return Array.from(this.sessions.entries())
      .filter(([_, state]) => state.session.isRunning)
      .map(([taskId, _]) => taskId);
  }

  async startAgent(
    task: Task,
    stage: TaskStage,
    agentConfig: AgentConfig,
    knowledgeResults?: KnowledgeResult[],
    initialUserMessage?: string
  ): Promise<void> {
    if (this.sessions.has(task.id)) {
      await this.stopAgent(task.id);
    }

    const optimizedPrompt = optimizeAgentPrompt({ task, stage, knowledgeResults });
    const promptText = initialUserMessage
      ? `${optimizedPrompt.text}\n\n【用户消息】\n${initialUserMessage}`
      : optimizedPrompt.text;

    const sessionId = `agent-${task.id}-${stage.id}-${Date.now()}`;
    const session: AgentSession = {
      sessionId,
      taskId: task.id,
      task,
      stage,
      optimizedPrompt,
      isRunning: true,
      agentType: agentConfig.type,
      customCommand: agentConfig.customCommand,
    };

    const state: TaskSessionState = {
      session,
      messageHistory: [],
      currentOutputBuffer: '',
      currentThinkingBuffer: '',
      unlistenOutput: null,
      unlistenThinking: null,
      unlistenExit: null,
    };

    this.sessions.set(task.id, state);

    state.unlistenOutput = await listen<AgentOutputEvent>('agent-output', (event) => {
      if (event.payload.task_id === task.id) {
        this.handleOutput(task.id, event.payload.data);
      }
    });

    state.unlistenThinking = await listen<AgentThinkingEvent>('agent-thinking', (event) => {
      if (event.payload.task_id === task.id) {
        this.handleThinking(task.id, event.payload.data);
      }
    });

    state.unlistenExit = await listen<AgentExitEvent>('agent-exit', (event) => {
      if (event.payload.task_id === task.id) {
        this.handleExit(task.id, event.payload.code);
      }
    });

    await contextHistory.logSystem(
      task.basePath,
      `Agent session started: ${agentConfig.type} for stage ${stage.name}`
    );

    await invoke('agent_start', {
      taskId: task.id,
      workingDir: task.basePath,
      prompt: promptText,
      agentType: agentConfig.type,
      customCommand: agentConfig.customCommand,
    });
  }

  async stopAgent(taskId: string): Promise<void> {
    const state = this.sessions.get(taskId);
    if (!state) return;

    state.session.isRunning = false;
    await contextHistory.logSystem(state.session.task.basePath, 'Agent session stopped');

    try {
      await invoke('agent_stop', { taskId });
    } catch (err) {
      console.error('[AgentRunner] Failed to stop agent:', err);
    }

    if (state.unlistenOutput) state.unlistenOutput();
    if (state.unlistenThinking) state.unlistenThinking();
    if (state.unlistenExit) state.unlistenExit();

    this.sessions.delete(taskId);
  }

  async stopAllAgents(): Promise<void> {
    const taskIds = Array.from(this.sessions.keys());
    for (const taskId of taskIds) {
      await this.stopAgent(taskId);
    }
  }

  async sendInput(taskId: string, input: string): Promise<void> {
    const state = this.sessions.get(taskId);
    if (!state) {
      throw new Error('没有正在运行的 Agent 会话');
    }

    await contextHistory.logUserInput(state.session.task.basePath, input);

    state.messageHistory.push({ role: 'user', content: input });
    state.currentOutputBuffer = '';
    state.currentThinkingBuffer = '';
    state.session.isRunning = true;

    await invoke('agent_send', {
      taskId,
      prompt: input,
    });
  }

  private handleOutput(taskId: string, data: string): void {
    const state = this.sessions.get(taskId);
    if (!state) return;

    state.currentOutputBuffer += data;
    this.onOutputCallback?.(taskId, data);
    contextHistory.logAgentOutput(state.session.task.basePath, data).catch(() => {});

    const keyInfos = this.extractKeyInfo(data);
    for (const info of keyInfos) {
      this.onKeyInfoCallback?.(taskId, info);
    }
  }

  private handleThinking(taskId: string, data: string): void {
    const state = this.sessions.get(taskId);
    if (!state) return;

    state.currentThinkingBuffer += data;
    this.onThinkingCallback?.(taskId, data);
  }

  private handleExit(taskId: string, code: number): void {
    const state = this.sessions.get(taskId);
    if (state) {
      if (state.currentOutputBuffer.trim()) {
        state.messageHistory.push({
          role: 'assistant',
          content: state.currentOutputBuffer.trim(),
        });
        state.currentOutputBuffer = '';
      }
      state.currentThinkingBuffer = '';
      state.session.isRunning = false;
    }
    this.onExitCallback?.(taskId, code);
  }

  private extractKeyInfo(data: string): AgentKeyInfo[] {
    const infos: AgentKeyInfo[] = [];

    const fileWritePatterns = [
      /Writing to\s+(.+)/i,
      /Created\s+(.+)/i,
      /Wrote\s+(.+)/i,
      /写入文件[：:]\s*(.+)/i,
    ];
    for (const pattern of fileWritePatterns) {
      const match = data.match(pattern);
      if (match) {
        infos.push({ type: 'file_write', message: `写入文件：${match[1].trim()}`, detail: match[0] });
      }
    }

    const completionPatterns = [/Done\.?$/im, /Finished\.?$/im, /完成\.?$/im, /All tasks completed/i];
    for (const pattern of completionPatterns) {
      if (pattern.test(data)) {
        infos.push({ type: 'completion', message: 'Agent 任务完成', detail: data.trim() });
      }
    }

    const errorPatterns = [/Error[：:]\s*(.+)/i, /Failed[：:]\s*(.+)/i, /错误[：:]\s*(.+)/i];
    for (const pattern of errorPatterns) {
      const match = data.match(pattern);
      if (match) {
        infos.push({ type: 'error', message: `错误：${match[1].trim()}`, detail: data.trim() });
      }
    }

    return infos;
  }
}

export const agentRunner = new AgentRunner();
