import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect } from 'react';

export type AgentOption = {
  type: 'claude' | 'codex' | 'custom';
  label: string;
  description: string;
};

const AGENT_OPTIONS: AgentOption[] = [
  {
    type: 'claude',
    label: 'Claude Code CLI（推荐）',
    description: '通过 Claude Agent SDK 启动本地安装的 Claude Code',
  },
  {
    type: 'codex',
    label: 'Codex CLI',
    description: '通过 SDK 启动本地安装的 Codex',
  },
  {
    type: 'custom',
    label: '自定义命令',
    description: '配置自定义的 Agent 启动命令',
  },
];

interface StartupOverlayProps {
  phase: 'workspace' | 'agent';
  workspacePath?: string | null;
  onWorkspaceSelected: (path: string) => void;
  onAgentSelected: (agentType: string) => void;
  onBack?: () => void;
}

export default function StartupOverlay({
  phase,
  workspacePath,
  onWorkspaceSelected,
  onAgentSelected,
  onBack,
}: StartupOverlayProps) {
  const [savedAgent, setSavedAgent] = useState<string | null>(null);

  useEffect(() => {
    if (phase === 'agent') {
      invoke<{ agent?: { type: string } }>('get_global_config')
        .then((cfg) => {
          if (cfg.agent?.type) {
            setSavedAgent(cfg.agent.type);
          }
        })
        .catch(() => {});
    }
  }, [phase]);

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择工作区文件夹',
      });

      if (selected) {
        onWorkspaceSelected(selected);
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  if (phase === 'workspace') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900">
        <div className="flex flex-col items-center max-w-lg px-8">
          {/* Logo / Brand */}
          <div className="mb-6 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white text-xl font-bold">
              C
            </div>
            <h1 className="text-2xl font-bold text-white">Cospace</h1>
          </div>

          {/* Description */}
          <p className="text-gray-400 text-center mb-4">
            AI Agent 交付工作台。请选择一个工作区文件夹以开始使用。
          </p>
          <p className="text-gray-500 text-sm text-center mb-8">
            工作区是您存放项目代码和文档的目录，AI Agent 将在此目录中工作。
          </p>

          {/* Browse button */}
          <button
            onClick={handleSelectFolder}
            className="px-8 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-lg font-medium transition-colors"
          >
            选择工作区
          </button>

          <p className="text-gray-600 text-xs mt-6">
            提示：您也可以在应用中随时切换工作区
          </p>
        </div>
      </div>
    );
  }

  // Agent selection phase
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900">
      <div className="flex flex-col items-center max-w-xl px-8 w-full">
        {/* Logo / Brand */}
        <div className="mb-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center text-white text-xl font-bold">
            C
          </div>
          <h1 className="text-2xl font-bold text-white">Cospace</h1>
        </div>

        {/* Workspace context */}
        {workspacePath && (
          <p className="text-gray-500 text-sm text-center mb-2">
            工作区：<span className="text-gray-400">{workspacePath}</span>
          </p>
        )}

        {/* Description */}
        <p className="text-gray-400 text-center mb-6">
          选择默认的 Agent 工具。您可以在设置中随时更改。
        </p>

        {/* Agent options */}
        <div className="w-full space-y-3 mb-6">
          {AGENT_OPTIONS.map((agent) => (
            <button
              key={agent.type}
              onClick={() => onAgentSelected(agent.type)}
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
                savedAgent === agent.type
                  ? 'border-primary-500 bg-primary-500/10 hover:bg-primary-500/20'
                  : 'border-gray-700 bg-gray-800/50 hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-white font-medium">{agent.label}</span>
                {savedAgent === agent.type && (
                  <span className="text-primary-400 text-xs">上次使用</span>
                )}
              </div>
              <p className="text-gray-500 text-sm mt-1">{agent.description}</p>
            </button>
          ))}
        </div>

        {onBack && (
          <button
            onClick={onBack}
            className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            ← 返回上一步
          </button>
        )}
      </div>
    </div>
  );
}
