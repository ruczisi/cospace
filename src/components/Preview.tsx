import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Task } from '../services/taskManager';
import { getCompletedStageFiles, groupFilesByStage } from '../services/previewUtils';
import { knowledgeBase, type KnowledgeResult } from '../services/knowledgeBase';

interface PreviewProps {
  task: Task | null;
}

export default function Preview({ task }: PreviewProps) {
  const [selectedContent, setSelectedContent] = useState<string>('');
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<KnowledgeResult[]>([]);

  // Load templates from knowledge base
  useEffect(() => {
    knowledgeBase.getTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [task?.id]);

  // Auto-load current stage output document
  useEffect(() => {
    if (!task?.currentStageId) return;
    const currentStage = task.stages.find((s) => s.id === task.currentStageId);
    if (!currentStage || currentStage.outputs.length === 0) return;

    // Load the first output file of the current stage
    const firstOutput = currentStage.outputs[0];
    handleFileClick(firstOutput.path, firstOutput.name).catch(() => {
      // File may not exist yet, ignore error
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.currentStageId, task?.id]);

  const handleFileClick = useCallback(
    async (outputPath: string, outputName: string) => {
      if (!task) return;

      setIsLoading(true);
      setError(null);
      setSelectedFileName(outputName);

      try {
        const filePath = await join(task.basePath, outputPath);
        const content = await invoke<string>('read_text_file_command', {
          path: filePath,
        });
        setSelectedContent(content);
      } catch (err) {
        setError(`读取文件失败: ${err}`);
        setSelectedContent('');
      } finally {
        setIsLoading(false);
      }
    },
    [task]
  );

  if (!task) {
    return (
      <div className="w-96 bg-gray-800 border-l border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-sm font-medium text-gray-300">预览</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-gray-500">暂无任务</p>
        </div>
      </div>
    );
  }

  const files = getCompletedStageFiles(task);
  const groups = groupFilesByStage(files);

  return (
    <div className="w-96 bg-gray-800 border-l border-gray-700 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-sm font-medium text-gray-300">预览</h2>
      </div>

      {/* Templates */}
      <div className="p-4 border-b border-gray-700 max-h-40 overflow-y-auto">
        <h3 className="text-xs font-medium text-gray-400 mb-2">📚 知识库模板</h3>
        {templates.length === 0 ? (
          <p className="text-xs text-gray-500">暂无模板</p>
        ) : (
          <div className="space-y-1">
            {templates.map((tmpl, i) => (
              <button
                key={i}
                onClick={async () => {
                  try {
                    const content = await knowledgeBase.readDocument(tmpl.path);
                    setSelectedContent(content);
                    setSelectedFileName(tmpl.title);
                  } catch {
                    setError('读取模板失败');
                  }
                }}
                className="w-full text-left px-2 py-1 text-xs rounded text-gray-300 hover:bg-gray-700 transition-colors truncate"
                title={tmpl.description}
              >
                {tmpl.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* File List */}
      <div className="p-4 border-b border-gray-700 max-h-48 overflow-y-auto">
        <h3 className="text-xs font-medium text-gray-400 mb-2">输出文件</h3>
        {files.length === 0 ? (
          <p className="text-xs text-gray-500">暂无已生成的文档</p>
        ) : (
          <div className="space-y-3">
            {Array.from(groups.entries()).map(([stageName, stageFiles]) => (
              <div key={stageName}>
                <div className="text-xs text-green-400 mb-1">{stageName}</div>
                <div className="space-y-1">
                  {stageFiles.map((file, i) => (
                    <button
                      key={i}
                      onClick={() => handleFileClick(file.filePath, file.fileName)}
                      className={`w-full text-left px-2 py-1 text-xs rounded transition-colors ${
                        selectedFileName === file.fileName
                          ? 'bg-primary-700 text-white'
                          : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {file.fileName}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Content Preview */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-xs text-gray-400 animate-pulse">加载中...</div>
          </div>
        ) : error ? (
          <div className="text-xs text-red-400">{error}</div>
        ) : selectedContent ? (
          <div className="prose prose-invert prose-sm max-w-none">
            <div className="text-xs text-gray-400 mb-2 pb-2 border-b border-gray-700">
              {selectedFileName}
            </div>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {selectedContent}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-gray-500">点击左侧文件查看内容</p>
          </div>
        )}
      </div>
    </div>
  );
}
