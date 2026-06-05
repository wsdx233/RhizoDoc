import { describe, expect, it } from 'vitest';
import type { RhizoAnnotation, RhizoEdge, RhizoNode, TiledColumn, TiledPageLayout } from '../../shared/types.js';
import { computeElasticTiledLayouts } from './context-layout.js';

function node(id: string, parentId: string | null = null): RhizoNode {
  return {
    id,
    parentId,
    title: id,
    content: '',
    x: 0,
    y: 0,
    width: 340,
    height: 0,
    collapsed: false,
    generated: false,
    loading: false,
    direction: 'right',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function edge(sourceId: string, targetId: string): RhizoEdge {
  return { id: `${sourceId}-${targetId}`, sourceId, targetId };
}

function annotation(id: string, sourceNodeId: string, targetNodeId: string): RhizoAnnotation {
  return { id, sourceNodeId, targetNodeId, start: 0, length: 1, text: 'x', colorIndex: 0 };
}

function column(id: string, depth: number, pageIds: string[]): TiledColumn {
  return { id, depth, width: 420, pageIds };
}

function layout(nodeId: string, columnId: string, depth: number, order: number, y: number, height = 100): TiledPageLayout {
  return {
    nodeId,
    columnId,
    depth,
    order,
    x: depth * 434,
    y,
    width: 420,
    height,
    display: 'normal',
    columnOffsetY: 0,
  };
}

function nodeAnchors(values: Record<string, number>) {
  return {
    nodeAnchors: Object.fromEntries(Object.entries(values).map(([nodeId, center]) => [nodeId, {
      nodeId,
      kind: 'visible-content' as const,
      top: center,
      bottom: center,
      center,
      visibility: 'visible' as const,
    }])),
    annotationAnchors: {},
  };
}

function anchorRegistry({ node = {}, annotations = {} }: { node?: Record<string, number>; annotations?: Record<string, { nodeId: string; center: number; targetNodeId?: string; visibility?: 'visible' | 'above-viewport' | 'below-viewport' }> }) {
  return {
    nodeAnchors: nodeAnchors(node).nodeAnchors,
    annotationAnchors: Object.fromEntries(Object.entries(annotations).map(([annotationId, anchor]) => [annotationId, {
      nodeId: anchor.nodeId,
      kind: 'annotation-span' as const,
      top: anchor.center,
      bottom: anchor.center,
      center: anchor.center,
      visibility: anchor.visibility || 'visible',
      annotationId,
      targetNodeId: anchor.targetNodeId,
    }])),
  };
}

describe('computeElasticTiledLayouts', () => {
  it('keeps fixed order and prevents overlap while creating automatic active-context gaps', () => {
    const nodes = [node('source'), node('a'), node('b')];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, ['a', 'b'])];
    const pageLayouts = {
      source: layout('source', 'depth-0', 0, 0, 420),
      a: layout('a', 'depth-1', 1, 0, 52),
      b: layout('b', 'depth-1', 1, 1, 152),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('source-b', 'source', 'b')],
      focusNodeId: 'source',
      viewportHeight: 720,
      anchors: anchorRegistry({
        annotations: { 'source-b': { nodeId: 'source', center: 200, targetNodeId: 'b' } },
      }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));

    expect(byId.get('a')!.y).toBeLessThan(byId.get('b')!.y);
    expect(byId.get('b')!.y - byId.get('a')!.y).toBeGreaterThanOrEqual(114 - 1e-6);
    expect(byId.get('b')!.y).toBeGreaterThan(byId.get('b')!.baseY);
    expect(byId.get('b')!.extraGapBefore).toBeGreaterThan(0);
  });

  it('does not let offscreen annotation anchors pull layout to viewport boundaries', () => {
    const nodes = [node('source'), node('target')];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, ['target'])];
    const pageLayouts = {
      source: layout('source', 'depth-0', 0, 0, 420, 240),
      target: layout('target', 'depth-1', 1, 0, 52),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('source-target', 'source', 'target')],
      focusNodeId: 'source',
      viewportHeight: 720,
      anchors: anchorRegistry({
        node: { source: 20 },
        annotations: { 'source-target': { nodeId: 'source', center: 240, targetNodeId: 'target', visibility: 'below-viewport' } },
      }),
    });

    expect(result.find((item) => item.nodeId === 'target')!.y).toBeCloseTo(52);
  });

  it('uses visible annotation span anchors before generic node anchors for active annotation layout', () => {
    const nodes = [node('source'), node('target')];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, ['target'])];
    const pageLayouts = {
      source: layout('source', 'depth-0', 0, 0, 420, 240),
      target: layout('target', 'depth-1', 1, 0, 52),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('source-target', 'source', 'target')],
      focusNodeId: 'source',
      viewportHeight: 720,
      anchors: anchorRegistry({
        node: { source: 20 },
        annotations: { 'source-target': { nodeId: 'source', center: 200, targetNodeId: 'target' } },
      }),
    });

    expect(result.find((item) => item.nodeId === 'target')!.y).toBeGreaterThan(500);
  });

  it('uses source annotation span as the target endpoint when annotation focus is reversed', () => {
    const nodes = [node('source'), node('target')];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, ['target'])];
    const pageLayouts = {
      source: layout('source', 'depth-0', 0, 0, 52, 400),
      target: layout('target', 'depth-1', 1, 0, 600, 100),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('source-target', 'source', 'target')],
      focusNodeId: 'target',
      viewportHeight: 720,
      anchors: anchorRegistry({
        node: { target: 50 },
        annotations: { 'source-target': { nodeId: 'source', center: 200, targetNodeId: 'target' } },
      }),
    });

    const sourceY = result.find((item) => item.nodeId === 'source')!.y;
    expect(sourceY).toBeGreaterThan(300);
    expect(sourceY).toBeLessThan(550);
  });

  it('solves columns from a snapshot so left and right neighbors can align symmetrically around focus', () => {
    const nodes = [node('left'), node('focus'), node('right')];
    const columns = [column('depth-0', 0, ['left']), column('depth-1', 1, ['focus']), column('depth-2', 2, ['right'])];
    const pageLayouts = {
      left: layout('left', 'depth-0', 0, 0, 52),
      focus: layout('focus', 'depth-1', 1, 0, 420),
      right: layout('right', 'depth-2', 2, 0, 52),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('left-focus', 'left', 'focus'), annotation('focus-right', 'focus', 'right')],
      focusNodeId: 'focus',
      viewportHeight: 720,
      anchors: anchorRegistry({
        node: { focus: 50 },
        annotations: {
          'left-focus': { nodeId: 'left', center: 50, targetNodeId: 'focus' },
          'focus-right': { nodeId: 'focus', center: 50, targetNodeId: 'right' },
        },
      }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));

    expect(byId.get('left')!.y).toBeGreaterThan(52);
    expect(byId.get('right')!.y).toBeGreaterThan(52);
    expect(Math.abs(byId.get('left')!.y - byId.get('right')!.y)).toBeLessThan(3);
  });

  it('ignores previous rendered positions in canonical mode but uses them in interactive mode', () => {
    const nodes = [node('a')];
    const columns = [column('depth-0', 0, ['a'])];
    const pageLayouts = { a: layout('a', 'depth-0', 0, 0, 52) };

    const canonical = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [],
      previousY: { a: 500 },
      mode: 'canonical',
    });
    const interactive = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [],
      previousY: { a: 500 },
      mode: 'interactive',
    });

    expect(canonical[0].y).toBeCloseTo(52);
    expect(interactive[0].y).toBeGreaterThan(canonical[0].y);
  });

  it('lets annotation targets dominate weaker structural pulls', () => {
    const nodes = [node('ann'), node('struct'), node('target')];
    const columns = [column('depth-0', 0, ['struct', 'ann']), column('depth-1', 1, ['target'])];
    const pageLayouts = {
      struct: layout('struct', 'depth-0', 0, 0, 0),
      ann: layout('ann', 'depth-0', 0, 1, 500),
      target: layout('target', 'depth-1', 1, 0, 100),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [edge('struct', 'target')],
      annotations: [annotation('ann-target', 'ann', 'target')],
      focusNodeId: 'ann',
      viewportHeight: 720,
      anchors: anchorRegistry({
        annotations: { 'ann-target': { nodeId: 'ann', center: 200, targetNodeId: 'target' } },
      }),
    });

    expect(result.find((item) => item.nodeId === 'target')!.y).toBeGreaterThan(250);
  });

  it('keeps a many-child parent near the currently focused child', () => {
    const childIds = Array.from({ length: 30 }, (_, index) => `child-${index}`);
    const nodes = [node('parent'), ...childIds.map((id) => node(id, 'parent'))];
    const columns = [column('depth-0', 0, ['parent']), column('depth-1', 1, childIds)];
    const pageLayouts: Record<string, TiledPageLayout> = {
      parent: layout('parent', 'depth-0', 0, 0, 52),
    };
    childIds.forEach((id, index) => {
      pageLayouts[id] = layout(id, 'depth-1', 1, index, 52 + index * 100);
    });

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: childIds.map((id) => edge('parent', id)),
      annotations: [],
      focusNodeId: 'child-29',
      viewportHeight: 720,
      anchors: nodeAnchors({ 'child-29': 50 }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));

    expect(Math.abs(byId.get('parent')!.y - byId.get('child-29')!.y)).toBeLessThan(60);
    expect(byId.get('child-29')!.y).toBeCloseTo(byId.get('child-29')!.baseY);
  });

  it('does not collapse a many-child column toward a focused parent', () => {
    const childIds = Array.from({ length: 30 }, (_, index) => `child-${index}`);
    const nodes = [node('parent'), ...childIds.map((id) => node(id, 'parent'))];
    const columns = [column('depth-0', 0, ['parent']), column('depth-1', 1, childIds)];
    const pageLayouts: Record<string, TiledPageLayout> = {
      parent: layout('parent', 'depth-0', 0, 0, 52),
    };
    childIds.forEach((id, index) => {
      pageLayouts[id] = layout(id, 'depth-1', 1, index, 52 + index * 100);
    });

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: childIds.map((id) => edge('parent', id)),
      annotations: [],
      focusNodeId: 'parent',
      viewportHeight: 720,
      anchors: nodeAnchors({ parent: 50 }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));

    expect(byId.get('parent')!.y).toBeCloseTo(byId.get('parent')!.baseY);
    expect(byId.get('child-29')!.y).toBeCloseTo(byId.get('child-29')!.baseY);
  });
});
