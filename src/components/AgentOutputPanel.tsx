import { useState, useRef, useEffect } from 'react';
import type { AgentKeyInfo, AgentSession } from '../services/agentRunner';

interface AgentOutputPanelProps {
  session: AgentSession | null;
  isRunning: boolean;
  outputHistory: string[];
  keyInfos: AgentKeyInfo[];
  onStart: () => void;
  onStop: () => void;
  onSendInput?: (input: string) => void;
}

export default function AgentOutputPanel({
  session,
  isRunning,
  outputHistory,
  keyInfos,
  onStart,
  onStop,
  onSendInput,
}: AgentOutputPanelProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && showDetails) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [outputHistory, showDetails]);

  const handleSendInput = () => {
    if (!inputText.trim() || !onSendInput) return;
    onSendInput(inputText.trim());
    setInputText('');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Controls */}
      <div className="p-3 border-b border-gray-700 bg-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isRunning ? (
            <>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs text-green-400">Agent 运行中</span>
              </div>
              {session && (
                <span className="text-xs text-gray-500">
                  {session.task.name} / {session.stage.name}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-gray-500">Agent 未启动</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isRunning ? (
            <button
              onClick={onStart}
              className="px-3 py-1.5 text-xs bg-primary-600 hover:bg-primary-700 rounded text-white"
            >
              启动 Agent
            </button>
          ) : (
            <button
              onClick={onStop}
              className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 rounded text-white"
            >
              停止
            </button>
          )}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
          >
            {showDetails ? '隐藏详情' : '显示详情'}
          </button>
        </div>
      </div>

      {/* Key Info */}
      <div className="p-3 border-b border-gray-700">
        {keyInfos.length === 0 ? (
          <div className="text-xs text-gray-500 text-center py-2">
            {isRunning ? '等待 Agent 输出关键信息...' : '启动 Agent 后将显示关键信息'}
          </div>
        ) : (
          <div className="space-y-1.5">
            {keyInfos.slice(-5).map((info, i) => (
              <div
                key={i}
                className={`text-xs px-2 py-1.5 rounded flex items-center gap-2 ${
                  info.type === 'file_write'
                    ? 'bg-blue-900/30 border border-blue-800 text-blue-300'
                    : info.type === 'completion'
                    ? 'bg-green-900/30 border border-green-800 text-green-300'
                    : info.type === 'error'
                    ? 'bg-red-900/30 border border-red-800 text-red-300'
                    : 'bg-gray-800 text-gray-400'
                }`}
              >
                {info.type === 'file_write' && '📄'}
                {info.type === 'completion' && '✅'}
                {info.type === 'error' && '❌'}
                {info.type === 'thinking' && '💭'}
                <span>{info.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Details (Terminal Output) */}
      {showDetails && (
        <>
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-3 bg-gray-950 font-mono text-xs"
          >
            {outputHistory.length === 0 ? (
              <span className="text-gray-600">暂无输出...</span>
            ) : (
              outputHistory.map((chunk, i) => (
                <span key={i} className="text-gray-400 whitespace-pre-wrap">
                  {chunk}
                </span>
              ))
            )}
          </div>

          {/* Interactive Input */}
          {isRunning && onSendInput && (
            <div className="p-2 border-t border-gray-700 bg-gray-900 flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendInput();
                }}
                placeholder="向 Agent 发送消息..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-primary-500"
              />
              <button
                onClick={handleSendInput}
                disabled={!inputText.trim()}
                className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-gray-300"
              >
                发送
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
