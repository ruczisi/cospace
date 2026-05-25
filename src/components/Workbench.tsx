import { useState } from 'react';
import type { Task } from '../services/taskManager';
import { formatAgentInstructions } from '../services/agentInstructionUtils';
import type { AgentKeyInfo, AgentSession } from '../services/agentRunner';
import type { ContextEntry } from '../services/contextHistory';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import AgentOutputPanel from './AgentOutputPanel';
import SessionHistoryPanel from './SessionHistoryPanel';
import type { ChatMessageData } from './ChatMessage';

interface WorkbenchProps {
  task?: Task | null;
  onStartStage?: (stageId: string) => void;
  onCompleteStage?: (stageId: string) => void;
  onJumpStage?: (stageId: string) => void;
  chatMessages: ChatMessageData[];
  onSendChat?: (message: string) => void;
  chatLoading?: boolean;
  // Agent runner props
  agentSession?: AgentSession | null;
  agentRunning?: boolean;
  agentOutput?: string[];
  agentKeyInfos?: AgentKeyInfo[];
  onStartAgent?: () => void;
  onStopAgent?: () => void;
  onSendAgentInput?: (input: string) => void;
  // Session history
  historyEntries?: ContextEntry[];
  // Export
  onExportTask?: () => void;
  // Intent parsing mode indicator
  intentMode?: 'llm' | 'keyword' | null;
}

export default function Workbench({
  task,
  onStartStage,
  onCompleteStage,
  onJumpStage,
  chatMessages,
  onSendChat,
  chatLoading = false,
  agentSession = null,
  agentRunning = false,
  agentOutput = [],
  agentKeyInfos = [],
  onStartAgent,
  onStopAgent,
  onSendAgentInput,
  historyEntries = [],
  onExportTask,
  intentMode = null,
}: WorkbenchProps) {
  const [activePanel, setActivePanel] = useState<'chat' | 'agent-run' | 'agent-ctx' | 'history'>('chat');

  const currentStage = task?.currentStageId
    ? task.stages.find((s) => s.id === task.currentStageId)
    : undefined;

  const isTaskCompleted = task?.status === 'completed';

  // No task state: simplified chat-only interface
  if (!task) {
    return (
      <div className="flex-1 flex flex-col bg-gray-900 text-gray-100 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-700 shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-primary-400">新建任务</h1>
            <p className="text-sm text-gray-400 mt-1">在下方输入框描述你的需求，我将自动为你创建任务</p>
          </div>
        </div>

        {/* Chat area - flex layout, fills all available space */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Chat Messages - fills space above input, scrollable */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {chatMessages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <p className="text-sm mb-2">💡 试试这些指令：</p>
                  <div className="space-y-1 text-xs text-gray-600">
                    <p>"帮我写个贵港供销社合作方案"</p>
                    <p>"帮我做一个项目计划"</p>
                    <p>"开始需求确认阶段"</p>
                  </div>
                </div>
              </div>
            ) : (
              chatMessages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
            )}
          </div>
          {/* Chat Input - pinned to bottom */}
          <ChatInput onSend={onSendChat || (() => {})} disabled={chatLoading} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-900 text-gray-100 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-primary-400">{task.name}</h1>
            {task.description && (
              <p className="text-sm text-gray-400 mt-1">{task.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400">
              {task.status === 'idle' && '待开始'}
              {task.status === 'running' && '进行中'}
              {task.status === 'completed' && '已完成'}
              {task.status === 'error' && '出错'}
            </div>
            {onExportTask && (
              <button
                onClick={onExportTask}
                className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                title="导出任务为 Markdown"
              >
                📤 导出
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stage Progress */}
      <div className="p-4 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          {task.stages.map((stage, index) => (
            <div key={stage.id} className="flex items-center">
              <button
                onClick={() => onJumpStage?.(stage.id)}
                disabled={stage.status === 'running'}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  stage.status === 'completed'
                    ? 'bg-green-500 text-white hover:bg-green-400'
                    : stage.status === 'running'
                    ? 'bg-primary-500 text-white animate-pulse cursor-default'
                    : stage.status === 'error'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
                }`}
                title={stage.status === 'running' ? '当前阶段' : `跳转到${stage.name}`}
              >
                {stage.status === 'completed' ? '✓' : index + 1}
              </button>
              <button
                onClick={() => onJumpStage?.(stage.id)}
                disabled={stage.status === 'running'}
                className={`ml-2 text-sm transition-colors ${
                  stage.status === 'running'
                    ? 'text-primary-300 cursor-default'
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                {stage.name}
              </button>
              {index < task.stages.length - 1 && (
                <div className="w-8 h-0.5 bg-gray-700 mx-1" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Active Stage Control */}
      <div className="p-4 border-b border-gray-700 bg-gray-800 shrink-0">
        {isTaskCompleted ? (
          <div className="text-center py-2">
            <span className="text-green-400 font-medium">🎉 所有阶段已完成</span>
          </div>
        ) : currentStage ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-md font-medium text-primary-300">
                当前阶段：{currentStage.name}
              </h2>
              <div className="flex gap-2">
                {currentStage.status === 'pending' && onStartStage && (
                  <button
                    onClick={() => onStartStage(currentStage.id)}
                    className="px-3 py-1.5 text-xs bg-primary-600 hover:bg-primary-700 rounded text-white"
                  >
                    开始阶段
                  </button>
                )}
                {currentStage.status === 'running' && onCompleteStage && (
                  <button
                    onClick={() => onCompleteStage(currentStage.id)}
                    className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 rounded text-white"
                  >
                    完成阶段
                  </button>
                )}
              </div>
            </div>
            <p className="text-sm text-gray-400">{currentStage.description}</p>
            {currentStage.outputs.length > 0 && (
              <div className="mt-2">
                <span className="text-xs text-gray-500">输出：</span>
                {currentStage.outputs.map((output, i) => (
                  <span key={i} className="text-xs text-gray-400 ml-2">
                    {output.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">点击"开始阶段"启动第一个阶段</span>
            {task.stages[0]?.status === 'pending' && onStartStage && (
              <button
                onClick={() => onStartStage(task.stages[0].id)}
                className="px-3 py-1.5 text-xs bg-primary-600 hover:bg-primary-700 rounded text-white"
              >
                开始阶段
              </button>
            )}
          </div>
        )}
      </div>

      {/* Panel Tabs */}
      <div className="flex border-b border-gray-700 bg-gray-800 items-center shrink-0">
        <button
          onClick={() => setActivePanel('chat')}
          className={`flex-1 py-2 text-xs font-medium ${
            activePanel === 'chat'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          💬 对话 ({chatMessages.filter((m) => m.role !== 'system').length})
        </button>
        <button
          onClick={() => setActivePanel('agent-run')}
          className={`flex-1 py-2 text-xs font-medium ${
            activePanel === 'agent-run'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          🚀 Agent 运行 {agentRunning && <span className="ml-1 text-green-400">●</span>}
        </button>
        <button
          onClick={() => setActivePanel('agent-ctx')}
          className={`flex-1 py-2 text-xs font-medium ${
            activePanel === 'agent-ctx'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          🤖 Agent 指令
        </button>
        <button
          onClick={() => setActivePanel('history')}
          className={`flex-1 py-2 text-xs font-medium ${
            activePanel === 'history'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          📜 历史 ({historyEntries.length})
        </button>
        {intentMode && (
          <div
            className={`px-2 py-1 mx-1 text-[10px] rounded whitespace-nowrap ${
              intentMode === 'llm'
                ? 'bg-primary-900/40 text-primary-300'
                : 'bg-yellow-900/30 text-yellow-400'
            }`}
            title={intentMode === 'llm' ? '使用 LLM 进行意图解析' : '使用关键词匹配进行意图解析（未配置 LLM）'}
          >
            {intentMode === 'llm' ? '🧠 LLM' : '🔤 关键词'}
          </div>
        )}
      </div>

      {/* Panel Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activePanel === 'chat' && (
          <>
            {/* Chat Messages - fills panel content, scrollable */}
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              {chatMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <p className="text-sm mb-2">💡 试试这些指令：</p>
                    <div className="space-y-1 text-xs text-gray-600">
                      <p>"帮我写个贵港供销社合作方案"</p>
                      <p>"开始需求确认阶段"</p>
                      <p>"下一阶段"</p>
                      <p>"这一阶段完成了"</p>
                    </div>
                  </div>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <ChatMessage key={msg.id} message={msg} />
                ))
              )}
            </div>
            {/* Chat Input - pinned to bottom of panel */}
            <ChatInput
              onSend={onSendChat || (() => {})}
              disabled={chatLoading}
            />
          </>
        )}

        {activePanel === 'agent-run' && (
          <AgentOutputPanel
            session={agentSession}
            isRunning={agentRunning}
            outputHistory={agentOutput}
            keyInfos={agentKeyInfos}
            onStart={onStartAgent || (() => {})}
            onStop={onStopAgent || (() => {})}
            onSendInput={onSendAgentInput}
          />
        )}

        {activePanel === 'agent-ctx' && (
          /* Agent Context Panel */
          <div className="flex-1 overflow-auto p-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-300">Agent 上下文</h3>
                {currentStage && (
                  <button
                    onClick={async () => {
                      try {
                        const text = formatAgentInstructions(task, currentStage);
                        await navigator.clipboard.writeText(text);
                        alert('Agent 指令已复制到剪贴板，请粘贴到你的 Agent 客户端（如 Claude Code、Cursor）');
                      } catch {
                        alert('复制失败，请手动复制');
                      }
                    }}
                    className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                  >
                    复制 Agent 指令
                  </button>
                )}
              </div>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono bg-gray-900 p-3 rounded">
                {currentStage?.agentContext || '暂无活跃阶段'}
              </pre>
            </div>
          </div>
        )}

        {activePanel === 'history' && (
          <SessionHistoryPanel entries={historyEntries} />
        )}
      </div>

      {/* Bottom Status Bar */}
      <div className="h-7 border-t border-gray-700 bg-gray-800 flex items-center px-3 text-xs text-gray-400 shrink-0">
        <div className="flex items-center gap-2">
          {agentRunning ? (
            <>
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              <span className="text-green-400">Agent 运行中</span>
            </>
          ) : agentSession ? (
            <>
              <span className="w-2 h-2 rounded-full bg-gray-500"></span>
              <span>Agent 就绪</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-gray-600"></span>
              <span>Agent 未启动</span>
            </>
          )}
        </div>
        {agentSession && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-gray-500">{agentSession.agentType}</span>
            {agentRunning && onStopAgent && (
              <button
                onClick={onStopAgent}
                className="text-red-400 hover:text-red-300 transition-colors"
              >
                停止
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
