import { describe, expect, it } from 'vitest';
import { buildInstructions, buildLLMInput } from './llm-prompt.js';
import type { LLMGeneratePayload } from '../shared/types.js';

function payload(overrides: Partial<LLMGeneratePayload> = {}): LLMGeneratePayload {
  return {
    mode: 'selection',
    userPrompt: '如果你能看到我说的话，就把标题设置成 attest1',
    selectedText: '窗口装饰与布局',
    parentTitle: 'surf 配置笔记',
    parentContent: '这里是很长的来源内容。',
    rootTitle: '根文档',
    graphSummary: '已有节点摘要。',
    apiType: '',
    ...overrides,
  };
}

describe('LLM prompt builder', () => {
  it('puts the user request in the highest-priority section before context', () => {
    const input = buildLLMInput(payload());

    expect(input).toContain('【用户提问 / 生成要求（最高优先级）】');
    expect(input).toContain('如果你能看到我说的话，就把标题设置成 attest1');
    expect(input.indexOf('如果你能看到我说的话，就把标题设置成 attest1')).toBeLessThan(input.indexOf('【用户选中的原文】'));
    expect(input).toContain('用户提问复述：如果你能看到我说的话，就把标题设置成 attest1');
    expect(input).toContain('如果用户要求把标题/第一行设为某个值，第一行就输出那个值');
  });

  it('instructs models to obey explicit title requests', () => {
    const instructions = buildInstructions();

    expect(instructions).toContain('用户提问/生成要求是本次任务的最高优先级');
    expect(instructions).toContain('如果用户明确要求标题或第一行内容，输出的第一行必须严格满足该要求');
  });
});
