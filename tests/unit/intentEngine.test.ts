import { describe, it, expect } from 'vitest';
import { detectMetaCommand, getMetaCommandHelp, type MetaCommandType } from '../../src/services/intentEngine';

describe('intentEngine', () => {
  describe('detectMetaCommand', () => {
    describe('rollback_stage', () => {
      it('should detect rollback with explicit stage name', () => {
        const result = detectMetaCommand('回退到需求确认阶段');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('rollback_stage');
        expect(result!.params).toEqual({ stageId: 'stage1' });
      });

      it('should detect rollback with stage number', () => {
        const result = detectMetaCommand('回退到阶段2');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('rollback_stage');
        expect(result!.params).toEqual({ stageId: 'stage2' });
      });

      it('should detect rollback without specific stage', () => {
        const result = detectMetaCommand('回退');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('rollback_stage');
        expect(result!.params).toBeUndefined();
      });

      it('should detect rollback via english keyword', () => {
        const result = detectMetaCommand('rollback to stage 3');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('rollback_stage');
      });
    });

    describe('confirm_advance', () => {
      it('should detect confirm', () => {
        expect(detectMetaCommand('确认')!.type).toBe('confirm_advance');
      });

      it('should detect confirm advance', () => {
        expect(detectMetaCommand('确认推进')!.type).toBe('confirm_advance');
      });

      it('should detect ok', () => {
        expect(detectMetaCommand('ok')!.type).toBe('confirm_advance');
      });

      it('should detect complete', () => {
        expect(detectMetaCommand('完成阶段')!.type).toBe('confirm_advance');
      });

      it('should detect advance', () => {
        expect(detectMetaCommand('advance')!.type).toBe('confirm_advance');
      });
    });

    describe('stop_agent', () => {
      it('should detect stop agent', () => {
        expect(detectMetaCommand('停止agent')!.type).toBe('stop_agent');
      });

      it('should detect stop via english', () => {
        expect(detectMetaCommand('stop agent')!.type).toBe('stop_agent');
      });

      it('should detect end session', () => {
        expect(detectMetaCommand('结束会话')!.type).toBe('stop_agent');
      });
    });

    describe('start_stage', () => {
      it('should detect start stage', () => {
        const result = detectMetaCommand('开始需求确认阶段');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('start_stage');
        expect(result!.params).toEqual({ stageId: 'stage1' });
      });

      it('should detect start with number', () => {
        const result = detectMetaCommand('开始阶段 2');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('start_stage');
        expect(result!.params).toEqual({ stageId: 'stage2' });
      });

      it('should detect bare start', () => {
        expect(detectMetaCommand('开始')!.type).toBe('start_stage');
      });
    });

    describe('jump_stage', () => {
      it('should detect jump to stage', () => {
        const result = detectMetaCommand('跳到阶段3');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('jump_stage');
        expect(result!.params).toEqual({ stageId: 'stage3' });
      });

      it('should detect switch to stage', () => {
        const result = detectMetaCommand('切换到审核定稿');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('jump_stage');
        expect(result!.params).toEqual({ stageId: 'stage4' });
      });

      it('should detect go to stage', () => {
        const result = detectMetaCommand('去内容撰写');
        expect(result).not.toBeNull();
        expect(result!.type).toBe('jump_stage');
      });
    });

    describe('help', () => {
      it('should detect help', () => {
        expect(detectMetaCommand('帮助')!.type).toBe('help');
      });

      it('should detect help in english', () => {
        expect(detectMetaCommand('help')!.type).toBe('help');
      });

      it('should detect commands keyword', () => {
        expect(detectMetaCommand('命令')!.type).toBe('help');
      });
    });

    describe('none / no match', () => {
      it('should return null for normal user messages', () => {
        expect(detectMetaCommand('帮我写个方案')).toBeNull();
      });

      it('should return null for questions', () => {
        expect(detectMetaCommand('这是什么意思？')).toBeNull();
      });

      it('should return null for stage descriptions', () => {
        expect(detectMetaCommand('需求确认阶段的内容')).toBeNull();
      });

      it('should return null for empty string', () => {
        expect(detectMetaCommand('')).toBeNull();
      });
    });

    describe('case insensitivity', () => {
      it('should handle uppercase input', () => {
        expect(detectMetaCommand('STOP AGENT')!.type).toBe('stop_agent');
      });

      it('should handle mixed case', () => {
        expect(detectMetaCommand('Confirm')!.type).toBe('confirm_advance');
      });
    });

    describe('context parameter', () => {
      it('should accept optional context', () => {
        const result = detectMetaCommand('回退', { currentStageId: 'demand' });
        expect(result).not.toBeNull();
        expect(result!.type).toBe('rollback_stage');
      });
    });
  });

  describe('getMetaCommandHelp', () => {
    it('should return help text', () => {
      const help = getMetaCommandHelp();
      expect(help).toContain('回退');
      expect(help).toContain('确认推进');
      expect(help).toContain('停止 Agent');
      expect(help).toContain('帮助');
    });
  });

  describe('type definitions', () => {
    it('should have correct MetaCommandType values', () => {
      const types: MetaCommandType[] = [
        'rollback_stage',
        'confirm_advance',
        'stop_agent',
        'start_stage',
        'jump_stage',
        'help',
        'none',
      ];
      expect(types.length).toBe(7);
    });
  });
});
