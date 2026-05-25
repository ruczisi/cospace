import type { Task } from './taskManager';

export type MetaCommandType =
  | 'rollback_stage'
  | 'confirm_advance'
  | 'stop_agent'
  | 'start_stage'
  | 'jump_stage'
  | 'help'
  | 'none';

export interface MetaCommand {
  type: MetaCommandType;
  params?: Record<string, string>;
}

export interface ParseContext {
  currentTask?: Task;
  currentStageId?: string;
}

/**
 * 检测用户输入是否为阶段管理元指令
 *
 * 在 agent-led 架构下，应用不再做意图识别（由 Agent 工具完成）。
 * 应用只负责检测少数几条直接操作任务状态的元命令。
 */
export function detectMetaCommand(input: string, _context?: ParseContext): MetaCommand | null {
  const text = input.toLowerCase().trim();

  // --- 回退阶段 ---
  if (
    /^(回退|回滚|rollback|回退到|回滚到)/.test(text) ||
    /(回退|回滚).*(阶段|stage)/.test(text)
  ) {
    // 提取目标阶段
    const stageMatch = text.match(/阶段\s*(\d)|需求确认|框架构思|内容撰写|审核定稿/);
    let targetStageId = '';
    if (stageMatch) {
      const m = stageMatch[0];
      if (m.includes('需求') || m.includes('1')) targetStageId = 'stage1';
      else if (m.includes('框架') || m.includes('2')) targetStageId = 'stage2';
      else if (m.includes('内容') || m.includes('3')) targetStageId = 'stage3';
      else if (m.includes('审核') || m.includes('4')) targetStageId = 'stage4';
    }
    return { type: 'rollback_stage', params: targetStageId ? { stageId: targetStageId } : undefined };
  }

  // --- 确认推进（在 confirmationMode 下使用） ---
  if (
    /^(确认|确认推进|confirm|ok|好的|可以|同意|推进|advance)$/.test(text) ||
    /^(完成|完成阶段|complete)$/.test(text)
  ) {
    return { type: 'confirm_advance' };
  }

  // --- 停止 Agent ---
  if (
    /^(停止|停止agent|stop|stop agent|结束agent)/.test(text) ||
    /(停止|结束).*(agent|会话)/.test(text)
  ) {
    return { type: 'stop_agent' };
  }

  // --- 开始阶段 ---
  if (
    /^(开始|启动|start).*(阶段|stage)/.test(text) ||
    /^开始$/.test(text)
  ) {
    const stageMatch = text.match(/阶段\s*(\d)|需求确认|框架构思|内容撰写|审核定稿/);
    let stageId = '';
    if (stageMatch) {
      const m = stageMatch[0];
      if (m.includes('需求') || m.includes('1')) stageId = 'stage1';
      else if (m.includes('框架') || m.includes('2')) stageId = 'stage2';
      else if (m.includes('内容') || m.includes('3')) stageId = 'stage3';
      else if (m.includes('审核') || m.includes('4')) stageId = 'stage4';
    }
    return { type: 'start_stage', params: stageId ? { stageId } : undefined };
  }

  // --- 跳转到指定阶段 ---
  const jumpMatch = text.match(/(跳到|跳转|切换到?|去).*(阶段?\s*\d|需求确认|框架构思|内容撰写|审核定稿)/);
  if (jumpMatch) {
    let stageId = '';
    if (text.includes('需求') || text.includes('阶段1') || text.includes('阶段 1')) stageId = 'stage1';
    else if (text.includes('框架') || text.includes('阶段2') || text.includes('阶段 2')) stageId = 'stage2';
    else if (text.includes('内容') || text.includes('阶段3') || text.includes('阶段 3')) stageId = 'stage3';
    else if (text.includes('审核') || text.includes('阶段4') || text.includes('阶段 4')) stageId = 'stage4';
    return { type: 'jump_stage', params: stageId ? { stageId } : undefined };
  }

  // --- 帮助 ---
  if (/^(帮助|help|指令|命令|菜单)/.test(text)) {
    return { type: 'help' };
  }

  return null;
}

/**
 * 获取元命令帮助文本
 */
export function getMetaCommandHelp(): string {
  return `🎮 **可用元命令**（直接操作任务状态，不走 Agent）：

- **回退到 X 阶段** — 回退到指定阶段（如"回退到需求确认"）
- **确认推进** / **完成** — 手动确认推进到下一阶段
- **停止 Agent** — 停止当前 Agent 会话
- **跳到 X 阶段** — 跳转到指定阶段
- **开始** — 开始当前/第一个阶段
- **帮助** — 显示此帮助

其他所有消息都会直接转发给 Agent 处理。`;
}
