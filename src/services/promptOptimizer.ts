import type { Task, TaskStage } from './taskManager';
import type { KnowledgeResult } from './knowledgeBase';

export interface PromptContext {
  task: Task;
  stage: TaskStage;
  knowledgeResults?: KnowledgeResult[];
}

export interface ExpectedOutput {
  name: string;
  path: string;
}

export interface OptimizedPrompt {
  /** Full optimized prompt text */
  text: string;
  /** Key instruction bullets */
  keyInstructions: string[];
  /** Expected output files */
  expectedOutputs: ExpectedOutput[];
  /** Stage name */
  stageName: string;
}

/**
 * 根据任务上下文生成优化后的 Agent 提示词
 *
 * 将工作流阶段的原始 agentContext 与任务元数据结合，
 * 生成结构清晰、上下文完整的提示词，便于 Agent 工具直接执行。
 */
export function optimizeAgentPrompt(context: PromptContext): OptimizedPrompt {
  const { task, stage, knowledgeResults } = context;

  const keyInstructions = extractKeyInstructions(stage.agentContext);

  const expectedOutputs = stage.outputs.map((o) => ({
    name: o.name,
    path: o.path,
  }));

  const text = buildPromptText(task, stage, expectedOutputs, knowledgeResults);

  return {
    text,
    keyInstructions,
    expectedOutputs,
    stageName: stage.name,
  };
}

function extractKeyInstructions(agentContext: string): string[] {
  const lines = agentContext
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('•') || l.startsWith('-') || /^\d+[.、]/.test(l));

  if (lines.length === 0) {
    // Fallback: extract sentences that look like instructions
    return agentContext
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 10 && !l.startsWith('#') && !l.startsWith('>'))
      .slice(0, 5);
  }

  return lines.map((l) => l.replace(/^[•\-\d.、]+\s*/, '').trim()).filter(Boolean);
}

function buildPromptText(
  task: Task,
  stage: TaskStage,
  outputs: ExpectedOutput[],
  knowledgeResults?: KnowledgeResult[]
): string {
  const parts: string[] = [];

  // Header
  parts.push(`# 任务：${task.name}`);
  parts.push('');

  // Task description
  if (task.description) {
    parts.push(`## 任务描述`);
    parts.push(task.description);
    parts.push('');
  }

  // Stage info
  parts.push(`## 当前阶段：${stage.name}`);
  parts.push(`**阶段目标**：${stage.description}`);
  parts.push('');

  // Working directory
  parts.push(`## 工作目录`);
  parts.push('请在 `' + task.basePath + '` 目录下工作。');
  parts.push('');

  // Expected outputs
  if (outputs.length > 0) {
    parts.push(`## 预期输出`);
    for (const output of outputs) {
      parts.push('- `' + output.path + '` — ' + output.name);
    }
    parts.push('');
  }

  // Knowledge base context injection
  if (knowledgeResults && knowledgeResults.length > 0) {
    parts.push(`## 相关知识`);
    for (const kr of knowledgeResults) {
      parts.push(`- **${kr.title}** (${kr.type}) — ${kr.description}`);
      if (kr.path) {
        parts.push(`  来源：${kr.path}`);
      }
    }
    parts.push('');
  }

  // Agent context (original instructions)
  if (stage.agentContext) {
    parts.push(`## 执行要求`);
    parts.push(stage.agentContext);
    parts.push('');
  }

  // Output format reminder
  parts.push(`## 输出要求`);
  parts.push('1. 将生成内容写入到指定的文件路径中');
  parts.push('2. 使用 Markdown 格式');
  parts.push('3. 关键数据需标注来源');
  parts.push('4. 完成后报告文件写入路径');
  parts.push('');

  // Interaction guidance — require agent to proactively ask questions
  parts.push(`## 交互要求`);
  parts.push('**重要**：在开始具体工作前，请先主动向用户确认需要收集的关键信息。');
  parts.push('1. 不要假设任何信息，逐条向用户提问');
  parts.push('2. 每收到一条信息，简要确认并继续问下一个问题');
  parts.push('3. 当信息收集完整、阶段产物完成后，告知用户："本阶段已完成，请审阅产物并输入\'确认\'以继续下一阶段。"');
  parts.push('4. 如果用户已提供足够信息，可直接开始产出');
  parts.push('');
  parts.push('## 输出规范（严格遵循）');
  parts.push('- **直接输出**：只输出给用户的最终回复内容，禁止输出思考过程、内部分析、计划步骤');
  parts.push('- **禁止重复**：不要重复用户已经提供过的信息或系统已告知你的背景');
  parts.push('- **简洁确认**：收到用户信息后，用一句话简要确认即可，不要展开复述');
  parts.push('- **禁止元评论**：不要以"我需要...""我会...""让我..."开头描述你的行动计划');
  parts.push('- **一问一答**：每次只问用户一个问题，等待回答后再问下一个');

  return parts.join('\n');
}
