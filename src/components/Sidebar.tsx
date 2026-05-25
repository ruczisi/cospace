import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore, type SidebarTab } from '../stores/appStore';
import { taskManager } from '../services/taskManager';
import type { Task } from '../services/taskManager';
import { workflowManager, type SavedWorkflow } from '../services/workflowManager';
import type { WorkflowConfig } from '../services/workflowParser';
import WorkflowEditor from './WorkflowEditor';
import {
  LLM_PRESET_MODELS,
  getDefaultBaseUrl,
  getPresetModelById,
  validateLlmConfig,
  type LlmConfig,
} from '../services/llmConfig';
import { callLlm } from '../services/llmService';

interface SidebarProps {
  onCreateTask?: () => void;
  watchedPath: string | null;
  currentTask: Task | null;
  onSelectTask?: (task: Task) => void;
  onDeleteTask?: (taskId: string) => void;
  workflows?: SavedWorkflow[];
  onUseWorkflow?: (workflow: WorkflowConfig) => void;
  knowledgeBasePath?: string | null;
  kbStats?: { total: number };
  onSelectKnowledgeBase?: () => void;
}

interface GlobalConfig {
  agent?: {
    type: string;
    autoStart: boolean;
    customCommand?: string;
  };
  llm?: LlmConfig;
}

const TABS: { id: SidebarTab; icon: string; label: string }[] = [
  { id: 'workspace', icon: '📁', label: '工作区' },
  { id: 'history', icon: '📜', label: '历史' },
  { id: 'workflows', icon: '📋', label: '工作流' },
  { id: 'settings', icon: '⚙️', label: '设置' },
];

export default function Sidebar({
  onCreateTask,
  watchedPath,
  currentTask,
  onSelectTask,
  onDeleteTask,
  workflows,
  onUseWorkflow,
  knowledgeBasePath,
  kbStats,
  onSelectKnowledgeBase,
}: SidebarProps) {
  const { activeTab, setActiveTab } = useAppStore();
  const tasks = taskManager.getAllTasks();
  const [panelOpen, setPanelOpen] = useState(true);

  // Settings state
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [testResult, setTestResult] = useState('');
  const [editingWorkflow, setEditingWorkflow] = useState<SavedWorkflow | null>(null);
  const [creatingWorkflow, setCreatingWorkflow] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  // Load config when settings tab is opened
  useEffect(() => {
    if (activeTab === 'settings' && panelOpen) {
      loadConfig();
    }
  }, [activeTab, panelOpen]);

  const loadConfig = async () => {
    try {
      const cfg = await invoke<GlobalConfig>('get_global_config');
      if (!cfg.llm) {
        const defaultModel = LLM_PRESET_MODELS[0];
        cfg.llm = {
          provider: defaultModel.provider,
          apiKey: '',
          baseUrl: defaultModel.defaultBaseUrl,
          model: defaultModel.id,
        };
      }
      setConfig(cfg);
    } catch (err) {
      console.error('Failed to load config:', err);
      const defaultModel = LLM_PRESET_MODELS[0];
      setConfig({
        llm: {
          provider: defaultModel.provider,
          apiKey: '',
          baseUrl: defaultModel.defaultBaseUrl,
          model: defaultModel.id,
        },
        agent: { type: 'claude', autoStart: true },
      });
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    setLoading(true);
    setSaveMessage('');
    try {
      await invoke('save_global_config', { config });
      setSaveMessage('配置已保存');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      console.error('Failed to save config:', err);
      setSaveMessage('保存失败');
    } finally {
      setLoading(false);
    }
  };

  const updateLlmConfig = (updates: Partial<LlmConfig>) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        llm: { ...prev.llm!, ...updates },
      };
    });
  };

  const handleProviderChange = (provider: LlmConfig['provider']) => {
    const defaultUrl = getDefaultBaseUrl(provider);
    const preset = LLM_PRESET_MODELS.find((m) => m.provider === provider);
    updateLlmConfig({
      provider,
      baseUrl: defaultUrl,
      model: preset?.id || '',
    });
  };

  const handleTestConnection = async () => {
    if (!config?.llm) return;
    const validation = validateLlmConfig(config.llm);
    if (!validation.valid) {
      setTestResult(validation.errors.join('，'));
      return;
    }
    setTestResult('测试中...');
    try {
      const result = await callLlm(config.llm, {
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 10,
      });
      if (result.content || result.usage) {
        setTestResult(`连接成功 — 模型响应正常${result.usage ? `（消耗 ${result.usage.totalTokens} tokens）` : ''}`);
      } else {
        setTestResult('连接异常 — 模型返回空响应');
      }
    } catch (err) {
      setTestResult(`连接失败 — ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleIconClick = (tabId: SidebarTab) => {
    if (activeTab === tabId && panelOpen) {
      setPanelOpen(false);
    } else {
      setActiveTab(tabId);
      setPanelOpen(true);
    }
  };

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-400';
      case 'running':
        return 'text-primary-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusLabel = (status: Task['status']) => {
    switch (status) {
      case 'completed':
        return '已完成';
      case 'running':
        return '进行中';
      case 'error':
        return '出错';
      default:
        return '待开始';
    }
  };

  const activeTabInfo = TABS.find((t) => t.id === activeTab);

  return (
    <div className="flex h-full">
      {/* Activity Bar */}
      <div className="w-12 bg-gray-800 flex flex-col items-center border-r border-gray-700 select-none">
        {/* Main icons */}
        <div className="flex-1 flex flex-col items-center py-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleIconClick(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              onMouseLeave={() => setHoveredTab(null)}
              className={`relative w-full h-11 flex items-center justify-center transition-colors ${
                activeTab === tab.id && panelOpen
                  ? 'text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {/* Active indicator — left border */}
              {activeTab === tab.id && panelOpen && (
                <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary-500 rounded-r"
                />
              )}
              <span className="text-lg">{tab.icon}</span>
              {/* Custom tooltip */}
              {hoveredTab === tab.id && !panelOpen && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-gray-700 text-gray-200 text-xs rounded whitespace-nowrap z-50 pointer-events-none">
                  {tab.label}
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-1.5 h-1.5 bg-gray-700 rotate-45" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Sidebar Panel */}
      {panelOpen && (
        <div className="w-52 bg-gray-800 flex flex-col border-r border-gray-700">
          {/* Panel Header */}
          <div className="h-9 flex items-center px-3 text-xs font-semibold text-gray-300 uppercase tracking-wide border-b border-gray-700">
            {activeTabInfo?.label}
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-y-auto p-2">
            {activeTab === 'workspace' && (
              <>
                {/* Create Task Button */}
                {onCreateTask && (
                  <button
                    onClick={onCreateTask}
                    className="w-full text-left px-3 py-2 text-sm bg-primary-600 hover:bg-primary-700 rounded text-white"
                  >
                    + 新建任务
                  </button>
                )}

                {/* Workspace path display */}
                {watchedPath && (
                  <div className="mt-3">
                    <div className="text-xs text-gray-500 px-1 mb-1">当前工作区:</div>
                    <div className="text-xs text-gray-400 px-1 break-all bg-gray-900 p-1 rounded">
                      {watchedPath}
                    </div>
                  </div>
                )}
              </>
            )}

            {activeTab === 'history' && (
              <>
                {tasks.length === 0 ? (
                  <div className="text-xs text-gray-500 italic px-2 py-4 text-center">
                    暂无任务历史
                  </div>
                ) : (
                  <div className="space-y-1">
                    {tasks.map((task, index) => (
                      <div
                        key={task.id}
                        className={`group relative w-full text-left px-2 py-2 rounded text-xs transition-colors ${
                          currentTask?.id === task.id
                            ? 'bg-primary-700 text-white'
                            : 'text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        <button
                          onClick={() => onSelectTask?.(task)}
                          className="w-full text-left"
                        >
                          <div className="font-medium truncate">{task.name}</div>
                          <div className="flex items-center justify-between mt-1">
                            <span className={getStatusColor(task.status)}>
                              {getStatusLabel(task.status)}
                            </span>
                            <div className="flex items-center gap-1">
                              {index < 3 && (
                                <span className="text-[10px] px-1 bg-gray-700 rounded text-gray-400">
                                  Ctrl+{index + 1}
                                </span>
                              )}
                              <span className="text-gray-500">
                                {new Date(task.createdAt).toLocaleDateString('zh-CN')}
                              </span>
                            </div>
                          </div>
                        </button>
                        {onDeleteTask && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteTask(task.id);
                            }}
                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 px-1 transition-opacity"
                            title="删除任务"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTab === 'workflows' && (
              <div className="space-y-3">
                <button
                  onClick={() => setCreatingWorkflow(true)}
                  className="w-full text-left px-3 py-2 text-xs bg-primary-600 hover:bg-primary-700 rounded text-white flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  新建工作流
                </button>

                {!workflows || workflows.length === 0 ? (
                  <div className="text-xs text-gray-500 italic px-2 py-4 text-center">
                    暂无工作流
                  </div>
                ) : (
                  <div className="space-y-2">
                    {workflows.map((workflow) => (
                      <div
                        key={workflow.id}
                        className="bg-gray-900 rounded p-2"
                      >
                        <div className="text-xs font-medium text-gray-200 truncate">
                          {workflow.name}
                        </div>
                        {workflow.description && (
                          <div className="text-xs text-gray-500 mt-1 truncate">
                            {workflow.description}
                          </div>
                        )}
                        <div className="text-xs text-gray-500 mt-1">
                          {workflow.config.stages.length} 个阶段
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => onUseWorkflow?.(workflow.config)}
                            className="flex-1 px-2 py-1 text-xs bg-primary-600 hover:bg-primary-700 rounded text-white"
                          >
                            使用
                          </button>
                          <button
                            onClick={() => setEditingWorkflow(workflow)}
                            className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                          >
                            编辑
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-4">
                {/* LLM Configuration */}
                <div className="bg-gray-900 rounded p-3">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-medium text-primary-400">🤖 LLM 配置（意图解析）</h3>
                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded">可选</span>
                  </div>
                  <p className="text-[10px] text-gray-500 mb-3">
                    当前使用 {config?.agent?.type === 'claude' ? 'Claude Code' : config?.agent?.type === 'codex' ? 'Codex' : '自定义'} Agent，LLM 仅用于意图解析。不配置也可使用基础功能。
                  </p>

                  {!config ? (
                    <div className="text-xs text-gray-500 text-center py-2">加载中...</div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">提供商（国内优先）</label>
                        <select
                          value={config.llm?.provider || 'zhipu'}
                          onChange={(e) => handleProviderChange(e.target.value as LlmConfig['provider'])}
                          className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-primary-500"
                        >
                          {LLM_PRESET_MODELS.map((model) => (
                            <option key={model.id} value={model.provider}>
                              {model.name}
                            </option>
                          ))}
                        </select>
                        {config.llm && (
                          <p className="text-xs text-gray-500 mt-1">
                            {getPresetModelById(config.llm.model)?.description}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs text-gray-400 mb-1">模型名称</label>
                        <input
                          type="text"
                          value={config.llm?.model || ''}
                          onChange={(e) => updateLlmConfig({ model: e.target.value })}
                          className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-primary-500"
                          placeholder="模型名称"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-400 mb-1">API Key</label>
                        <input
                          type="password"
                          value={config.llm?.apiKey || ''}
                          onChange={(e) => updateLlmConfig({ apiKey: e.target.value })}
                          className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-primary-500"
                          placeholder="输入 API Key"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Base URL（可选）</label>
                        <input
                          type="text"
                          value={config.llm?.baseUrl || ''}
                          onChange={(e) => updateLlmConfig({ baseUrl: e.target.value })}
                          className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-primary-500"
                          placeholder={getDefaultBaseUrl(config.llm?.provider || 'zhipu')}
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleTestConnection}
                          className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                        >
                          测试连接
                        </button>
                        {testResult && (
                          <span className="text-xs text-gray-400">{testResult}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Agent Tool Configuration */}
                <div className="bg-gray-900 rounded p-3">
                  <h3 className="text-xs font-medium text-primary-400 mb-3">🛠️ Agent 工具配置</h3>

                  {!config ? (
                    <div className="text-xs text-gray-500 text-center py-2">加载中...</div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">默认 Agent 工具</label>
                        <select
                          value={config.agent?.type || 'claude'}
                          onChange={(e) =>
                            setConfig((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    agent: {
                                      ...prev.agent,
                                      type: e.target.value,
                                      autoStart: prev.agent?.autoStart ?? true,
                                    },
                                  }
                                : prev
                            )
                          }
                          className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-primary-500"
                        >
                          <option value="claude">Claude Code</option>
                          <option value="codex">Codex</option>
                          <option value="custom">自定义</option>
                        </select>
                      </div>

                      {config.agent?.type === 'custom' && (
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">自定义命令</label>
                          <input
                            type="text"
                            value={config.agent?.customCommand || ''}
                            onChange={(e) =>
                              setConfig((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      agent: {
                                        ...prev.agent,
                                        type: 'custom',
                                        customCommand: e.target.value,
                                        autoStart: prev.agent?.autoStart ?? true,
                                      },
                                    }
                                  : prev
                              )
                            }
                            className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-primary-500"
                            placeholder="自定义 Agent 启动命令"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Knowledge Base Configuration */}
                <div className="bg-gray-900 rounded p-3">
                  <h3 className="text-xs font-medium text-primary-400 mb-3">📚 知识库配置</h3>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">知识库根目录</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={knowledgeBasePath || ''}
                          readOnly
                          className="flex-1 text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-primary-500"
                          placeholder="选择知识库目录"
                        />
                        <button
                          onClick={async () => {
                            try {
                              const selected = await open({ directory: true });
                              if (selected && typeof selected === 'string') {
                                onSelectKnowledgeBase?.();
                              }
                            } catch {
                              // Dialog cancelled or error
                            }
                          }}
                          className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300 whitespace-nowrap"
                        >
                          浏览
                        </button>
                      </div>
                      {knowledgeBasePath && kbStats && (
                        <p className="text-xs text-gray-500 mt-1">
                          共 {kbStats.total} 篇文档
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Save Button */}
                <button
                  onClick={saveConfig}
                  disabled={loading || !config}
                  className="w-full px-3 py-2 text-xs bg-primary-600 hover:bg-primary-700 disabled:bg-gray-700 rounded text-white"
                >
                  {loading ? '保存中...' : '保存配置'}
                </button>

                {saveMessage && (
                  <div className="text-xs text-center text-green-400">{saveMessage}</div>
                )}
              </div>
            )}
          </div>

          {/* Panel Footer */}
          <div className="p-2 border-t border-gray-700 text-xs text-gray-500">
            v2.0.0
          </div>
        </div>
      )}

      {/* Workflow Editor Modal */}
      {editingWorkflow && (
        <WorkflowEditor
          workflow={editingWorkflow}
          onSave={async (updated) => {
            await workflowManager.saveWorkflow(updated);
            setEditingWorkflow(null);
            window.dispatchEvent(new CustomEvent('cospace:refresh-workflows'));
          }}
          onClose={() => setEditingWorkflow(null)}
        />
      )}
      {creatingWorkflow && (
        <WorkflowEditor
          isNew={true}
          basePath={watchedPath || undefined}
          onSave={async (updated) => {
            await workflowManager.saveWorkflow(updated);
            setCreatingWorkflow(false);
            window.dispatchEvent(new CustomEvent('cospace:refresh-workflows'));
          }}
          onClose={() => setCreatingWorkflow(false)}
        />
      )}
    </div>
  );
}
