import { useState, useEffect, useCallback, useRef } from 'react';
import { join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import Sidebar from './components/Sidebar';
import Workbench from './components/Workbench';
import Preview from './components/Preview';
import StartupOverlay from './components/StartupOverlay';
import TaskCreateModal from './components/TaskCreateModal';
import { useAppStore } from './stores/appStore';
import { taskManager, type Task } from './services/taskManager';
import { STANDARD_4STAGE_WORKFLOW } from './services/embeddedWorkflow';
import { detectMetaCommand, getMetaCommandHelp, type MetaCommand } from './services/intentEngine';
import type { LlmConfig } from './services/llmConfig';
import { agentRunner, type AgentKeyInfo, type AgentSession } from './services/agentRunner';
import { fileWatcher } from './services/fileWatcher';
import { workflowManager, type SavedWorkflow } from './services/workflowManager';
import { knowledgeBase } from './services/knowledgeBase';
import { contextHistory } from './services/contextHistory';
import { exportTaskToMarkdown } from './services/taskExporter';
import type { ChatMessageData } from './components/ChatMessage';
import type { ContextEntry } from './services/contextHistory';
import type { WorkflowConfig } from './services/workflowParser';

const STORAGE_KEY = 'cospace-v2-workspace';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
}

function App() {
  const [theme] = useState<'dark' | 'light'>('dark');
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [showWorkbench, setShowWorkbench] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessageData[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [intentMode, setIntentMode] = useState<'llm' | 'keyword' | null>(null);

  // Agent runner state
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<ContextEntry[]>([]);
  const [agentOutput, setAgentOutput] = useState<string[]>([]);
  const [agentKeyInfos, setAgentKeyInfos] = useState<AgentKeyInfo[]>([]);
  const [workflows, setWorkflows] = useState<SavedWorkflow[]>([]);
  const [knowledgeBasePath, setKnowledgeBasePath] = useState<string | null>(null);
  const [kbStats, setKbStats] = useState<{ total: number }>({ total: 0 });

  // Responsive layout state
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isMobile = windowWidth < 768;
  const showPreview = windowWidth >= 1024;

  // Ref to track current task for callbacks without stale closures
  const currentTaskRef = useRef(currentTask);
  // Ref to track the current agent message ID for streaming output
  const agentMessageIdRef = useRef<string | null>(null);
  // Ref to accumulate thinking content for the current assistant message
  const agentThinkingRef = useRef<string>('');
  useEffect(() => {
    currentTaskRef.current = currentTask;
  }, [currentTask]);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const {
    startupPhase,
    setStartupPhase,
    setWatchedPath,
    watchedPath,
  } = useAppStore();

  // Load KB config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const cfg = await invoke<{
          llm?: LlmConfig;
          knowledge_base?: { root_path: string };
        }>('get_global_config');
        if (cfg.llm?.apiKey) {
          setIntentMode('llm');
        } else {
          // Auto-detect LLM config from environment / agent configs
          try {
            const detected = await invoke<{
              provider: string;
              api_key: string;
              base_url: string;
              model: string;
              source: string;
            } | null>('detect_llm_config');
            if (detected) {
              const autoConfig: LlmConfig = {
                provider: detected.provider as LlmConfig['provider'],
                apiKey: detected.api_key,
                baseUrl: detected.base_url,
                model: detected.model,
              };
              setIntentMode('llm');
              // Save to global config for persistence
              const fullCfg = await invoke<Record<string, unknown>>('get_global_config');
              await invoke('save_global_config', {
                config: {
                  ...fullCfg,
                  llm: autoConfig,
                },
              });
            } else {
              setIntentMode('keyword');
            }
          } catch {
            setIntentMode('keyword');
          }
        }
        if (cfg.knowledge_base?.root_path) {
          knowledgeBase.setRootPath(cfg.knowledge_base.root_path);
          setKnowledgeBasePath(cfg.knowledge_base.root_path);
          setKbStats(knowledgeBase.getStats());
        }
      } catch {
        // Use default config
      }
    };
    loadConfig();
  }, []);

  // On mount: check for saved workspace and load task history
  useEffect(() => {
    const init = async () => {
      const savedPath = localStorage.getItem(STORAGE_KEY);
      if (savedPath) {
        setWatchedPath(savedPath);
        // Check if agent config exists
        try {
          const cfg = await invoke<{ agent?: { type?: string } }>('get_global_config');
          if (cfg.agent?.type) {
            setStartupPhase('ready');
            setShowWorkbench(true);
          } else {
            setStartupPhase('select-agent');
          }
        } catch {
          setStartupPhase('select-agent');
        }
        // Load tasks from disk first (authoritative)
        try {
          const tasksDir = await join(savedPath, 'tasks');
          await taskManager.loadTasksFromDisk(tasksDir);
        } catch {
          // tasks dir may not exist yet
        }
        // Fallback to localStorage for legacy tasks
        taskManager.loadFromStorage();
      } else {
        setStartupPhase('select-workspace');
      }
    };
    init();
  }, [setWatchedPath, setStartupPhase, setShowWorkbench]);

  // Scan workflows directory when watchedPath changes
  useEffect(() => {
    if (!watchedPath) return;
    const scan = async () => {
      try {
        const wfPath = await join(watchedPath, 'workflows');
        const loaded = await workflowManager.loadWorkflows(wfPath);
        setWorkflows(loaded);
      } catch {
        // No workflows dir or no workflows
      }
    };
    scan();
    // Refresh when workflow editor saves
    const handler = () => scan();
    window.addEventListener('cospace:refresh-workflows', handler);
    return () => window.removeEventListener('cospace:refresh-workflows', handler);
  }, [watchedPath]);

  const addMessage = useCallback((role: ChatMessageData['role'], content: string) => {
    setChatMessages((prev) => [...prev, { id: generateId(), role, content, timestamp: Date.now() }]);
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    addMessage('system', content);
  }, [addMessage]);

  // Setup agent runner callbacks (filtered by current task)
  useEffect(() => {
    agentRunner.onOutput((taskId, data) => {
      if (taskId !== currentTaskRef.current?.id) return;
      setAgentOutput((prev) => [...prev, data]);
      // Also sync to chat messages for streaming display
      setChatMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.id === agentMessageIdRef.current) {
          // Append to existing agent message
          return [
            ...prev.slice(0, -1),
            { ...lastMsg, content: lastMsg.content + data },
          ];
        } else {
          // Create new agent message
          const newId = generateId();
          agentMessageIdRef.current = newId;
          agentThinkingRef.current = '';
          return [...prev, { id: newId, role: 'assistant', content: data, timestamp: Date.now() }];
        }
      });
    });
    agentRunner.onThinking((taskId, data) => {
      if (taskId !== currentTaskRef.current?.id) return;
      agentThinkingRef.current += data;
      // Sync thinking to current assistant message
      setChatMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.id === agentMessageIdRef.current) {
          return [
            ...prev.slice(0, -1),
            { ...lastMsg, thinking: agentThinkingRef.current },
          ];
        }
        return prev;
      });
    });
    agentRunner.onKeyInfo((taskId, info) => {
      if (taskId === currentTaskRef.current?.id) {
        setAgentKeyInfos((prev) => [...prev, info]);
      }
    });
    agentRunner.onExit((taskId, _code) => {
      if (taskId === currentTaskRef.current?.id) {
        setAgentRunning(false);
        setAgentSession(null);
        agentMessageIdRef.current = null;
        agentThinkingRef.current = '';
        // Auto-focus chat input after agent response completes
        requestAnimationFrame(() => {
          const input = document.querySelector<HTMLInputElement>('[data-chat-input="true"]');
          input?.focus();
        });
      }
    });
  }, [addMessage]);

  // Setup file watcher with auto-advance logic
  useEffect(() => {
    fileWatcher.on({
      onStageOutputChanged: async (stage, filePath) => {
        const task = currentTaskRef.current;
        if (!task || stage.id !== task.currentStageId) return;

        const fileName = filePath.split(/[\\/]/).pop() || filePath;

        // Always enter confirmation mode when stage output is detected
        // User must review and confirm before advancing
        taskManager.setConfirmationMode(task.id, true);
        taskManager.saveToStorage();

        addMessage(
          'system',
          `📁 阶段「${stage.name}」产物已生成：「${fileName}」。\n\n请审阅右侧预览区的产物内容。确认无误后，输入"确认"或"确认推进"以继续下一阶段。`
        );
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addMessage]);

  // Start/stop file watcher when task changes
  useEffect(() => {
    if (currentTask) {
      fileWatcher.setTask(currentTask);
      fileWatcher.startWatching(currentTask.basePath).catch((err) => {
        console.error('[Cospace] Failed to start file watcher:', err);
      });
    } else {
      fileWatcher.stopWatching();
    }
    return () => {
      fileWatcher.stopWatching();
    };
  }, [currentTask?.id, currentTask?.basePath]);

  // Create task from chat intent
  const createTaskFromIntent = useCallback(
    async (name: string, description?: string, workflow?: WorkflowConfig): Promise<Task | null> => {
      if (!watchedPath) {
        addMessage('assistant', '请先选择工作区才能创建任务。');
        return null;
      }
      try {
        const taskBasePath = await join(watchedPath, 'tasks', `task-${Date.now()}`);
        const task = await taskManager.createTaskFromWorkflow(
          name,
          workflow || STANDARD_4STAGE_WORKFLOW,
          taskBasePath,
          description
        );
        setCurrentTask(task);
        setShowWorkbench(true);
        taskManager.saveToStorage();
        return task;
      } catch (err) {
        console.error('[Cospace] Failed to create task:', err);
        addMessage('assistant', `创建任务失败: ${err}`);
        return null;
      }
    },
    [watchedPath, addMessage]
  );

  // Wrap user message with task/stage context before forwarding to Agent
  const wrapMessageWithContext = useCallback(
    (message: string, task: Task, stage: import('./services/taskManager').TaskStage): string => {
      const outputs = stage.outputs.map((o) => `- ${o.name}: ${o.path}`).join('\n');
      const completedStages =
        task.stages
          .filter((s) => s.status === 'completed')
          .map((s) => `- ${s.name}`)
          .join('\n') || '无';

      return `【任务上下文】
任务名称：${task.name}
当前阶段：${stage.name}
阶段目标：${stage.description}
阶段输出文件：
${outputs}

已完成阶段：
${completedStages}

【用户消息】
${message}`;
    },
    []
  );

  // Start agent for a specific task+stage
  const startAgentForStage = useCallback(
    async (task: Task, stage: import('./services/taskManager').TaskStage, initialUserMessage?: string) => {
      try {
        const cfg = await invoke<{
          agent?: { type: string; customCommand?: string };
          llm?: LlmConfig;
        }>('get_global_config');
        const agentConfig = {
          type: (cfg.agent?.type || 'claude') as 'claude' | 'codex' | 'custom',
          customCommand: cfg.agent?.customCommand,
        };

        setAgentOutput([]);
        setAgentKeyInfos([]);
        agentMessageIdRef.current = null;
        agentThinkingRef.current = '';
        setAgentRunning(true);

        const kbResults = await knowledgeBase.searchForTask(task);
        await agentRunner.startAgent(task, stage, agentConfig, kbResults, initialUserMessage);

        const session = agentRunner.getSession(task.id);
        setAgentSession(session);
      } catch (err) {
        console.error('[Cospace] Failed to start agent:', err);
        setAgentRunning(false);
        addMessage('system', `启动 Agent 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [addMessage]
  );

  // Handle meta-commands (rollback, confirm, stop, etc.)
  const handleMetaCommand = useCallback(
    async (meta: MetaCommand) => {
      switch (meta.type) {
        case 'rollback_stage': {
          if (!currentTask) {
            addMessage('system', '没有活跃的任务。');
            return;
          }
          const targetStageId = meta.params?.stageId || currentTask.currentStageId;
          if (!targetStageId) {
            addMessage('system', '无法确定回退目标阶段。');
            return;
          }
          const updated = await taskManager.rollbackStage(currentTask.id, targetStageId);
          if (updated) {
            setCurrentTask(updated);
            taskManager.saveToStorage();
            const stageName = updated.stages.find((s) => s.id === targetStageId)?.name;
            addMessage('system', `⏪ 已回退到阶段「${stageName}」。当前处于确认模式，输入"确认推进"继续。`);
          }
          break;
        }

        case 'confirm_advance': {
          if (!currentTask?.currentStageId) {
            addMessage('system', '没有正在进行的阶段。');
            return;
          }
          const updated = await taskManager.completeStage(currentTask.id, currentTask.currentStageId);
          if (updated) {
            setCurrentTask(updated);
            taskManager.saveToStorage();
            const nextStage = updated.stages.find((s) => s.status === 'running');
            if (nextStage) {
              addMessage('system', `✅ 阶段完成！已推进到「${nextStage.name}」。`);
              await startAgentForStage(updated, nextStage);
            } else {
              addMessage('system', '🎉 所有阶段已完成！');
            }
          }
          break;
        }

        case 'stop_agent': {
          if (!currentTask) {
            addMessage('system', '没有活跃的任务。');
            return;
          }
          await agentRunner.stopAgent(currentTask.id);
          setAgentRunning(false);
          setAgentSession(null);
          addMessage('system', 'Agent 已停止');
          break;
        }

        case 'start_stage': {
          if (!currentTask) {
            addMessage('system', '没有活跃的任务。');
            return;
          }
          const stageId = meta.params?.stageId || currentTask.stages.find((s) => s.status === 'pending')?.id;
          if (!stageId) {
            addMessage('system', '没有可开始的阶段。');
            return;
          }
          const stage = currentTask.stages.find((s) => s.id === stageId);
          if (!stage || stage.status !== 'pending') {
            addMessage('system', `阶段「${stage?.name}」不可开始。`);
            return;
          }
          const updated = taskManager.startStage(currentTask.id, stageId);
          if (updated) {
            setCurrentTask(updated);
            taskManager.saveToStorage();
            await startAgentForStage(updated, stage);
          }
          break;
        }

        case 'jump_stage': {
          if (!currentTask) {
            addMessage('system', '没有活跃的任务。');
            return;
          }
          const targetStageId = meta.params?.stageId;
          if (!targetStageId) {
            addMessage('system', '请指定要跳转到的阶段。');
            return;
          }
          const updated = taskManager.jumpToStage(currentTask.id, targetStageId);
          if (updated) {
            setCurrentTask(updated);
            taskManager.saveToStorage();
            const targetStage = updated.stages.find((s) => s.id === targetStageId);
            addMessage('system', `⏭️ 已跳转到阶段「${targetStage?.name}」。`);
          }
          break;
        }

        case 'help': {
          addMessage('assistant', getMetaCommandHelp());
          break;
        }
      }
    },
    [currentTask, addMessage, startAgentForStage]
  );

  // Handle chat message — agent-led flow
  const handleSendChat = useCallback(
    async (message: string) => {
      addMessage('user', message);
      setChatLoading(true);

      try {
        // === Phase 0: Detect meta-commands ===
        const meta = detectMetaCommand(message, {
          currentTask: currentTask || undefined,
          currentStageId: currentTask?.currentStageId,
        });
        if (meta) {
          await handleMetaCommand(meta);
          setChatLoading(false);
          return;
        }

        // === Phase 1: No task → auto-create from message ===
        if (!currentTask) {
          if (!watchedPath) {
            addMessage('system', '请先选择工作区');
            setChatLoading(false);
            return;
          }
          const task = await createTaskFromIntent(message, message);
          if (!task) {
            setChatLoading(false);
            return;
          }
          // Auto-start first stage
          const firstStage = task.stages[0];
          if (!firstStage) {
            setChatLoading(false);
            return;
          }
          const updated = taskManager.startStage(task.id, firstStage.id);
          if (!updated) {
            setChatLoading(false);
            return;
          }
          setCurrentTask(updated);
          taskManager.saveToStorage();
          addMessage('system', `🚀 已创建任务「${updated.name}」并启动阶段「${firstStage.name}」。`);
          const wrappedMessage = wrapMessageWithContext(message, updated, firstStage);
          await startAgentForStage(updated, firstStage, wrappedMessage);
          setChatLoading(false);
          return;
        }

        // === Phase 2: Task exists → find running stage ===
        let runningStage = currentTask.stages.find(
          (s) => s.id === currentTask.currentStageId && s.status === 'running'
        );

        if (!runningStage) {
          // No running stage, try to start the first pending stage
          const pendingStage = currentTask.stages.find((s) => s.status === 'pending');
          if (!pendingStage) {
            addMessage('system', '所有阶段已完成。输入"回退到X阶段"可回退，或创建新任务。');
            setChatLoading(false);
            return;
          }
          const updated = taskManager.startStage(currentTask.id, pendingStage.id);
          if (!updated) {
            setChatLoading(false);
            return;
          }
          setCurrentTask(updated);
          taskManager.saveToStorage();
          const wrappedMessage = wrapMessageWithContext(message, updated, pendingStage);
          await startAgentForStage(updated, pendingStage, wrappedMessage);
          setChatLoading(false);
          return;
        }

        // === Phase 3: Ensure agent is running for this stage ===
        if (!agentRunner.isTaskRunning(currentTask.id)) {
          const wrappedMessage = wrapMessageWithContext(message, currentTask, runningStage);
          await startAgentForStage(currentTask, runningStage, wrappedMessage);
          setChatLoading(false);
          return;
        }

        // === Phase 4: Agent is running → forward follow-up message ===
        const wrappedMessage = wrapMessageWithContext(message, currentTask, runningStage);
        await agentRunner.sendInput(currentTask.id, wrappedMessage);
      } catch (err) {
        console.error('[Cospace] Chat handling error:', err);
        addMessage('system', `错误: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setChatLoading(false);
      }
    },
    [currentTask, watchedPath, addMessage, createTaskFromIntent, handleMetaCommand, startAgentForStage, wrapMessageWithContext]
  );

  // Stage management callbacks
  const handleStartStage = async (stageId: string) => {
    if (!currentTask) return;
    const updated = taskManager.startStage(currentTask.id, stageId);
    if (!updated) return;

    setCurrentTask(updated);
    taskManager.saveToStorage();
    const stage = updated.stages.find((s) => s.id === stageId);
    if (stage) {
      await startAgentForStage(updated, stage);
    }
  };

  const handleCompleteStage = async (stageId: string) => {
    if (!currentTask) return;
    const updated = await taskManager.completeStage(currentTask.id, stageId);
    if (updated) {
      setCurrentTask(updated);
      taskManager.saveToStorage();

      const nextStage = updated.stages.find((s) => s.status === 'running');
      if (nextStage) {
        addMessage('system', `✅ 阶段完成！已推进到「${nextStage.name}」。`);
        await startAgentForStage(updated, nextStage);
      } else {
        addMessage('system', '🎉 所有阶段已完成！任务结束。');
      }
    }
  };

  const handleStartAgent = async () => {
    if (!currentTask?.currentStageId) {
      addMessage('system', '没有正在进行的阶段，请先开始一个阶段。');
      return;
    }
    const stage = currentTask.stages.find((s) => s.id === currentTask.currentStageId);
    if (!stage) return;
    await startAgentForStage(currentTask, stage);
  };

  const handleStopAgent = async () => {
    if (!currentTask) return;
    await agentRunner.stopAgent(currentTask.id);
    setAgentRunning(false);
    setAgentSession(null);
    agentMessageIdRef.current = null;
    addMessage('system', 'Agent 已停止');
  };

  const handleSendAgentInput = async (input: string) => {
    if (!currentTask) return;
    try {
      await agentRunner.sendInput(currentTask.id, input);
    } catch (err) {
      console.error('[Cospace] Failed to send agent input:', err);
    }
  };

  const handleExportTask = async () => {
    if (!currentTask) return;
    try {
      const result = await exportTaskToMarkdown(currentTask);
      addMessage('system', `任务已导出: ${result.path} (${result.stageCount} 个阶段, ${result.fileCount} 个文件)`);
    } catch (err) {
      console.error('[Cospace] Failed to export task:', err);
      addMessage('system', `导出失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Delete a task
  const handleDeleteTask = useCallback(
    (taskId: string) => {
      const isCurrent = currentTask?.id === taskId;
      taskManager.deleteTask(taskId);
      taskManager.saveToStorage();
      if (isCurrent) {
        setCurrentTask(null);
        setShowWorkbench(false);
      }
    },
    [currentTask]
  );

  // Select a task from history
  const handleSelectTask = useCallback(async (task: Task) => {
    setCurrentTask(task);
    setShowWorkbench(true);
    // Clear chat and agent state when switching tasks
    setChatMessages([]);
    setAgentOutput([]);
    setAgentKeyInfos([]);
    setAgentRunning(false);
    setAgentSession(null);
    // Load context history
    try {
      const history = await contextHistory.load(task.basePath);
      setHistoryEntries(history);
      if (history.length > 0) {
        const msgs: ChatMessageData[] = history.map((entry) => ({
          id: generateId(),
          role: entry.role === 'user' ? 'user' : entry.role === 'system' ? 'system' : 'assistant',
          content: entry.content,
          timestamp: new Date(entry.timestamp).getTime(),
        }));
        setChatMessages(msgs);
      }
    } catch {
      setHistoryEntries([]);
    }
    addSystemMessage(`已切换到任务「${task.name}」`);
  }, [addSystemMessage]);

  // Keyboard shortcuts: Ctrl+1/2/3 to switch tasks
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const idx = parseInt(e.key, 10);
      if (isNaN(idx) || idx < 1 || idx > 3) return;
      const tasks = taskManager.getAllTasks();
      const task = tasks[idx - 1];
      if (task) {
        e.preventDefault();
        handleSelectTask(task);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSelectTask]);

  // Handle workspace selection
  const handleWorkspaceSelected = (path: string) => {
    localStorage.setItem(STORAGE_KEY, path);
    setWatchedPath(path);
    setStartupPhase('select-agent');
  };

  // Handle agent selection
  const handleAgentSelected = async (agentType: string) => {
    try {
      const cfg = await invoke<Record<string, unknown>>('get_global_config');
      await invoke('save_global_config', {
        config: {
          ...cfg,
          agent: {
            type: agentType,
            autoStart: true,
          },
        },
      });
      setStartupPhase('ready');
    } catch (err) {
      console.error('[Cospace] Failed to save agent config:', err);
      // Still proceed even if save fails
      setStartupPhase('ready');
    }
  };

  // Select workspace folder
  const handleSelectWorkspace = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择工作区文件夹',
      });
      if (selected) {
        handleWorkspaceSelected(selected);
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  // Open task creation modal
  const handleCreateNewTask = () => {
    if (!watchedPath) {
      alert('请先选择工作区');
      return;
    }
    setShowTaskModal(true);
  };

  // Create task from modal
  const handleCreateTaskFromModal = async (
    name: string,
    description: string,
    workflow: WorkflowConfig
  ) => {
    try {
      const taskBasePath = await join(watchedPath!, 'tasks', `task-${Date.now()}`);
      const task = await taskManager.createTaskFromWorkflow(
        name,
        workflow,
        taskBasePath,
        description
      );
      setCurrentTask(task);
      setShowWorkbench(true);
      setChatMessages([]);
      addSystemMessage(`已创建任务「${name}」`);
      taskManager.saveToStorage();
      setShowTaskModal(false);
    } catch (err) {
      console.error('[Cospace] Failed to create task:', err);
      alert(`创建任务失败: ${err}`);
    }
  };

  // Select knowledge base directory
  const handleSelectKnowledgeBase = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择知识库根目录',
      });
      if (selected) {
        knowledgeBase.setRootPath(selected);
        setKnowledgeBasePath(selected);
        setKbStats(knowledgeBase.getStats());
        const cfg = await invoke<Record<string, unknown>>('get_global_config');
        await invoke('save_global_config', {
          config: {
            ...cfg,
            knowledge_base: {
              root_path: selected,
              concepts_dir: '20-Wiki/Concepts',
              projects_dir: '20-Wiki/Projects',
              auto_inject: true,
              max_results: 10,
            },
          },
        });
      }
    } catch (err) {
      console.error('[Cospace] KB config save error:', err);
    }
  }, []);

  // Use a custom workflow to create a task
  const handleUseWorkflow = useCallback(
    async (workflow: WorkflowConfig) => {
      if (!watchedPath) {
        addMessage('assistant', '请先选择工作区才能创建任务。');
        return;
      }
      addMessage('assistant', `正在使用工作流「${workflow.name}」创建任务...`);
      const task = await createTaskFromIntent(workflow.name, workflow.description, workflow);
      if (task) {
        addMessage('assistant', `✅ 已使用工作流「${task.name}」创建任务。`);
      }
    },
    [watchedPath, addMessage, createTaskFromIntent]
  );

  return (
    <div className={`${theme} h-full flex flex-col bg-gray-900 text-gray-100`}>
      {/* Startup overlay */}
      {(startupPhase === 'select-workspace' || startupPhase === 'select-agent') && (
        <StartupOverlay
          phase={startupPhase === 'select-workspace' ? 'workspace' : 'agent'}
          workspacePath={watchedPath}
          onWorkspaceSelected={handleWorkspaceSelected}
          onAgentSelected={handleAgentSelected}
          onBack={
            startupPhase === 'select-agent'
              ? () => setStartupPhase('select-workspace')
              : undefined
          }
        />
      )}

      {/* Main app content */}
      {startupPhase === 'ready' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Mobile sidebar toggle */}
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="absolute top-2 left-2 z-50 p-2 bg-gray-800 rounded text-gray-300 hover:text-white"
              title={sidebarOpen ? '隐藏侧边栏' : '显示侧边栏'}
            >
              {sidebarOpen ? '◀' : '▶'}
            </button>
          )}

          {/* Sidebar */}
          {(!isMobile || sidebarOpen) && (
            <div className={`${isMobile ? 'absolute z-40 h-full' : ''} flex-shrink-0`}>
              <Sidebar
                onCreateTask={handleCreateNewTask}
                watchedPath={watchedPath}
                currentTask={currentTask}
                onSelectTask={handleSelectTask}
                onDeleteTask={handleDeleteTask}
                workflows={workflows}
                onUseWorkflow={handleUseWorkflow}
                knowledgeBasePath={knowledgeBasePath}
                kbStats={kbStats}
                onSelectKnowledgeBase={handleSelectKnowledgeBase}
              />
            </div>
          )}

          <div className="flex-1 flex flex-col border-x border-gray-700 min-w-0">
            {showWorkbench ? (
              <Workbench
                task={currentTask}
                onStartStage={handleStartStage}
                onCompleteStage={handleCompleteStage}
                onJumpStage={(stageId) => {
                  if (!currentTask) return;
                  const updated = taskManager.jumpToStage(currentTask.id, stageId);
                  if (updated) {
                    setCurrentTask(updated);
                    taskManager.saveToStorage();
                    addMessage('system', `已跳转到阶段「${updated.stages.find((s) => s.id === stageId)?.name}」`);
                  }
                }}
                chatMessages={chatMessages}
                onSendChat={handleSendChat}
                chatLoading={chatLoading}
                agentSession={agentSession}
                agentRunning={agentRunning}
                agentOutput={agentOutput}
                agentKeyInfos={agentKeyInfos}
                onStartAgent={handleStartAgent}
                onStopAgent={handleStopAgent}
                onSendAgentInput={handleSendAgentInput}
                historyEntries={historyEntries}
                onExportTask={handleExportTask}
                intentMode={intentMode}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <p className="mb-4">点击侧边栏"+ 新建任务"开始</p>
                  {!watchedPath && (
                    <button
                      onClick={handleSelectWorkspace}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
                    >
                      选择工作区
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {showPreview && <Preview task={currentTask} />}
        </div>
      )}
      <TaskCreateModal
        isOpen={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        onCreate={handleCreateTaskFromModal}
        workflows={workflows}
        defaultWorkflow={STANDARD_4STAGE_WORKFLOW}
      />
    </div>
  );
}

export default App;
