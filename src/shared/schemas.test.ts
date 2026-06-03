import { describe, expect, it } from 'vitest';
import { isFlowObject, normalizeFlowName, validateFlow, validateLLMPayload } from './schemas.js';

describe('shared schemas', () => {
  it('normalizes unsafe flow names', () => {
    expect(normalizeFlowName(' hello/world?.json ')).toBe('hello_world_');
    expect(normalizeFlowName('', 'fallback')).toBe('fallback');
  });

  it('validates and normalizes flow objects', () => {
    const flow = validateFlow({
      name: 'demo',
      nodes: [
        { id: 'root', title: 'Root', content: '# Hello', width: 9999 },
        { id: 'child', title: 'Child', content: 'World' },
      ],
      edges: [{ sourceId: 'root', targetId: 'child' }],
    });
    expect(flow.name).toBe('demo');
    expect(flow.nodes[0].width).toBe(820);
    expect(flow.edges[0].sourceId).toBe('root');
    expect(flow.annotations).toEqual([]);
    expect(isFlowObject(flow)).toBe(true);
  });

  it('rejects invalid flow objects', () => {
    expect(() => validateFlow({ nodes: [] })).toThrow(/edges/);
  });

  it('rejects duplicate node ids', () => {
    expect(() => validateFlow({
      nodes: [{ id: 'root' }, { id: 'root' }],
      edges: [],
    })).toThrow(/id 重复/);
  });

  it('rejects edges referencing missing nodes', () => {
    expect(() => validateFlow({
      nodes: [{ id: 'root' }],
      edges: [{ sourceId: 'root', targetId: 'missing' }],
    })).toThrow(/不存在的目标节点/);
  });

  it('rejects cyclic graphs', () => {
    expect(() => validateFlow({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { sourceId: 'a', targetId: 'b' },
        { sourceId: 'b', targetId: 'a' },
      ],
    })).toThrow(/DAG/);
  });

  it('normalizes LLM payloads', () => {
    const payload = validateLLMPayload({ mode: 'unknown', prompt: 'x', selectedText: 42 });
    expect(payload.mode).toBe('selection');
    expect(payload.userPrompt).toBe('x');
    expect(payload.selectedText).toBe('42');
  });
});
