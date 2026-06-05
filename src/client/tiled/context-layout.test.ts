import { describe, expect, it } from 'vitest';
import type { RhizoAnnotation, RhizoEdge, RhizoNode, TiledColumn, TiledPageLayout } from '../../shared/types.js';
import { computeElasticTiledLayouts } from './context-layout.js';

function node(id: string, parentId: string | null = null, generated = false): RhizoNode {
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
    generated,
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

function anchorRegistry({ node = {}, annotations = {} }: { node?: Record<string, number>; annotations?: Record<string, { nodeId: string; center: number; targetNodeId?: string; visibility?: 'visible' | 'above-viewport' | 'below-viewport'; offscreenDistance?: number }> }) {
  return {
    nodeAnchors: nodeAnchors(node).nodeAnchors,
    annotationAnchors: Object.fromEntries(Object.entries(annotations).map(([annotationId, anchor]) => [annotationId, {
      nodeId: anchor.nodeId,
      kind: 'annotation-span' as const,
      top: anchor.center,
      bottom: anchor.center,
      center: anchor.center,
      visibility: anchor.visibility || 'visible',
      offscreenDistance: anchor.offscreenDistance,
      annotationId,
      targetNodeId: anchor.targetNodeId,
    }])),
  };
}

describe('computeElasticTiledLayouts', () => {
  it('keeps fixed order and compactness while relation field translates the stack', () => {
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
    expect(byId.get('b')!.y).toBeGreaterThan(byId.get('b')!.compactY);
    expect(byId.get('b')!.extraGapBefore).toBeCloseTo(0);
  });

  it('uses a weaker bounded cue when an annotation span is below the viewport', () => {
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

    const target = result.find((item) => item.nodeId === 'target')!;
    expect(target.y).toBeGreaterThan(500);
    expect(target.y).toBeLessThan(590);
    expect(target.relationPull).toBeLessThan(600);
  });

  it('uses a weaker bounded cue when an annotation span is above the viewport', () => {
    const nodes = [node('source'), node('target')];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, ['target'])];
    const pageLayouts = {
      source: layout('source', 'depth-0', 0, 0, 420, 240),
      target: layout('target', 'depth-1', 1, 0, 620),
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
        node: { source: 200 },
        annotations: { 'source-target': { nodeId: 'source', center: 0, targetNodeId: 'target', visibility: 'above-viewport' } },
      }),
    });

    const target = result.find((item) => item.nodeId === 'target')!;
    expect(target.y).toBeGreaterThan(330);
    expect(target.y).toBeLessThan(430);
    expect(target.y).toBeLessThan(target.compactY);
  });

  it('allows nearest offscreen cues to coexist with visible span anchors', () => {
    const nodes = [node('source'), node('offscreen'), node('visible')];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, ['offscreen', 'visible'])];
    const pageLayouts = {
      source: layout('source', 'depth-0', 0, 0, 420, 240),
      offscreen: layout('offscreen', 'depth-1', 1, 0, 52),
      visible: layout('visible', 'depth-1', 1, 1, 166),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('source-offscreen', 'source', 'offscreen'), annotation('source-visible', 'source', 'visible')],
      focusNodeId: 'source',
      viewportHeight: 720,
      anchors: anchorRegistry({
        annotations: {
          'source-offscreen': { nodeId: 'source', center: 240, targetNodeId: 'offscreen', visibility: 'below-viewport', offscreenDistance: 120 },
          'source-visible': { nodeId: 'source', center: 200, targetNodeId: 'visible' },
        },
      }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));

    expect(byId.get('offscreen')!.y).toBeGreaterThan(400);
    expect(byId.get('offscreen')!.y).toBeLessThan(byId.get('visible')!.y);
    expect(byId.get('offscreen')!.relationPull).toBeLessThan(600);
    expect(byId.get('visible')!.y).toBeGreaterThan(500);
  });

  it('uses the nearest offscreen cue while keeping farther annotations as weaker node-level fallback', () => {
    const nodes = [node('source'), node('far'), node('near')];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, ['far', 'near'])];
    const pageLayouts = {
      source: layout('source', 'depth-0', 0, 0, 420, 240),
      far: layout('far', 'depth-1', 1, 0, 52),
      near: layout('near', 'depth-1', 1, 1, 166),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('source-far', 'source', 'far'), annotation('source-near', 'source', 'near')],
      focusNodeId: 'source',
      viewportHeight: 720,
      anchors: anchorRegistry({
        annotations: {
          'source-far': { nodeId: 'source', center: 240, targetNodeId: 'far', visibility: 'below-viewport', offscreenDistance: 400 },
          'source-near': { nodeId: 'source', center: 240, targetNodeId: 'near', visibility: 'below-viewport', offscreenDistance: 20 },
        },
      }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));

    expect(byId.get('far')!.relationPull).toBeGreaterThan(180);
    expect(byId.get('far')!.relationPull).toBeLessThan(byId.get('near')!.relationPull);
    expect(byId.get('near')!.y).toBeGreaterThan(500);
  });

  it('decays far offscreen span refinements while retaining a weak base relation', () => {
    const nodes = [node('source'), node('far'), node('near')];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, ['far', 'near'])];
    const pageLayouts = {
      source: layout('source', 'depth-0', 0, 0, 100, 240),
      far: layout('far', 'depth-1', 1, 0, 52),
      near: layout('near', 'depth-1', 1, 1, 166),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('source-far', 'source', 'far'), annotation('source-near', 'source', 'near')],
      focusNodeId: 'source',
      viewportHeight: 720,
      anchors: anchorRegistry({
        annotations: {
          'source-far': { nodeId: 'source', center: 240, targetNodeId: 'far', visibility: 'below-viewport', offscreenDistance: 400 },
          'source-near': { nodeId: 'source', center: 240, targetNodeId: 'near', visibility: 'below-viewport', offscreenDistance: 20 },
        },
      }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));

    expect(byId.get('far')!.y).toBeGreaterThan(byId.get('far')!.compactY + 80);
    expect(byId.get('far')!.y).toBeLessThan(byId.get('near')!.y);
    expect(byId.get('far')!.relationPull).toBeLessThan(180);
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

  it('does not let reverse annotation focus pull the source panel by its annotation span', () => {
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
    expect(sourceY).toBeCloseTo(52);
  });

  it('pulls forward annotation targets without pulling reverse annotation sources', () => {
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

    expect(byId.get('left')!.y).toBeCloseTo(52);
    expect(byId.get('right')!.y).toBeGreaterThan(52);
  });

  it('translates unanchored stack segments with the relation field instead of preserving empty holes', () => {
    const targetIds = ['top-a', 'active-target', 'middle-c', 'unrelated-lower'];
    const nodes = [node('source'), ...targetIds.map((id) => node(id))];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, targetIds)];
    const pageLayouts: Record<string, TiledPageLayout> = {
      source: layout('source', 'depth-0', 0, 0, 60, 300),
    };
    targetIds.forEach((id, index) => {
      pageLayouts[id] = layout(id, 'depth-1', 1, index, 20 + index * 320, 260);
    });

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('source-active', 'source', 'active-target')],
      focusNodeId: 'source',
      viewportHeight: 720,
      anchors: anchorRegistry({
        node: { source: 60 },
        annotations: { 'source-active': { nodeId: 'source', center: 60, targetNodeId: 'active-target' } },
      }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));

    expect(byId.get('active-target')!.y).toBeLessThan(byId.get('active-target')!.compactY - 180);
    expect(byId.get('unrelated-lower')!.y).toBeLessThan(byId.get('unrelated-lower')!.compactY - 200);
    expect(byId.get('unrelated-lower')!.y - byId.get('middle-c')!.y - byId.get('middle-c')!.height).toBeLessThan(120);
  });

  it('keeps weak non-current annotation relations inside the visible relation field instead of reopening holes', () => {
    const targetIds = ['other-language', 'gpu-architecture', 'atomic-primitives', 'memory-barrier', 'jmm'];
    const nodes = [node('source'), ...targetIds.map((id) => node(id))];
    const columns = [column('depth-1', 1, ['source']), column('depth-2', 2, targetIds)];
    const pageLayouts: Record<string, TiledPageLayout> = {
      source: layout('source', 'depth-1', 1, 0, 52, 517.75),
      'other-language': layout('other-language', 'depth-2', 2, 0, 52, 360),
      'gpu-architecture': layout('gpu-architecture', 'depth-2', 2, 1, 412, 360),
      'atomic-primitives': layout('atomic-primitives', 'depth-2', 2, 2, 772, 583.75),
      'memory-barrier': layout('memory-barrier', 'depth-2', 2, 3, 1355.75, 360),
      jmm: layout('jmm', 'depth-2', 2, 4, 1715.75, 360),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [
        annotation('source-gpu', 'source', 'gpu-architecture'),
        annotation('source-atomic', 'source', 'atomic-primitives'),
        annotation('source-barrier', 'source', 'memory-barrier'),
        annotation('source-jmm', 'source', 'jmm'),
      ],
      focusNodeId: 'source',
      viewportHeight: 720,
      anchors: anchorRegistry({
        node: { source: 258 },
        annotations: {
          'source-atomic': { nodeId: 'source', center: 230, targetNodeId: 'atomic-primitives' },
          'source-barrier': { nodeId: 'source', center: 260, targetNodeId: 'memory-barrier' },
        },
      }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));
    const barrier = byId.get('memory-barrier')!;
    const jmm = byId.get('jmm')!;
    const gapBeforeJmm = jmm.y - barrier.y - barrier.height;

    expect(barrier.y).toBeGreaterThan(byId.get('atomic-primitives')!.y);
    expect(gapBeforeJmm).toBeLessThan(80);
  });

  it('interpolates relation fields by compact geometry instead of ordinal index', () => {
    const nodes = [node('source'), node('top'), node('middle'), node('bottom')];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, ['top', 'middle', 'bottom'])];
    const pageLayouts = {
      source: layout('source', 'depth-0', 0, 0, 0, 1400),
      top: layout('top', 'depth-1', 1, 0, 0, 100),
      middle: layout('middle', 'depth-1', 1, 1, 100, 500),
      bottom: layout('bottom', 'depth-1', 1, 2, 600, 100),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('source-top', 'source', 'top'), annotation('source-bottom', 'source', 'bottom')],
      focusNodeId: 'source',
      viewportHeight: 720,
      anchors: anchorRegistry({
        annotations: {
          'source-top': { nodeId: 'source', center: 50, targetNodeId: 'top' },
          'source-bottom': { nodeId: 'source', center: 1278, targetNodeId: 'bottom' },
        },
      }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));
    const top = byId.get('top')!;
    const middle = byId.get('middle')!;
    const bottom = byId.get('bottom')!;
    const expectedMiddleOffset = bottom.fieldOffset * ((middle.compactY - top.compactY) / (bottom.compactY - top.compactY));

    expect(middle.fieldOffset).toBeCloseTo(expectedMiddleOffset, 3);
    expect(middle.fieldOffset).toBeLessThan(bottom.fieldOffset / 2);
  });

  it('preserves a lower panel gap when that panel has its own visible semantic anchor', () => {
    const nodes = [node('source'), node('upper'), node('lower')];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, ['upper', 'lower'])];
    const pageLayouts = {
      source: layout('source', 'depth-0', 0, 0, 0, 900),
      upper: layout('upper', 'depth-1', 1, 0, 0, 100),
      lower: layout('lower', 'depth-1', 1, 1, 100, 100),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('source-upper', 'source', 'upper'), annotation('source-lower', 'source', 'lower')],
      focusNodeId: 'source',
      viewportHeight: 720,
      anchors: anchorRegistry({
        annotations: {
          'source-upper': { nodeId: 'source', center: 50, targetNodeId: 'upper' },
          'source-lower': { nodeId: 'source', center: 764, targetNodeId: 'lower' },
        },
      }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));
    const upper = byId.get('upper')!;
    const lower = byId.get('lower')!;
    const gapBeforeLower = lower.y - upper.y - upper.height;

    expect(gapBeforeLower).toBeGreaterThan(300);
    expect(lower.fieldOffset).toBeGreaterThan(500);
  });

  it('lets active visible annotations pull a deep ordered-stack target into the current reading lens', () => {
    const targetIds = ['other-a', 'other-b', 'other-c', 'other-d', 'jmm'];
    const nodes = [node('source'), ...targetIds.map((id) => node(id))];
    const columns = [column('depth-0', 0, ['source']), column('depth-1', 1, targetIds)];
    const pageLayouts: Record<string, TiledPageLayout> = {
      source: layout('source', 'depth-0', 0, 0, 250, 400),
    };
    targetIds.forEach((id, index) => {
      pageLayouts[id] = layout(id, 'depth-1', 1, index, 20 + index * 300, 260);
    });

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('source-jmm', 'source', 'jmm')],
      focusNodeId: 'source',
      viewportHeight: 720,
      anchors: anchorRegistry({
        node: { source: 170 },
        annotations: { 'source-jmm': { nodeId: 'source', center: 170, targetNodeId: 'jmm' } },
      }),
    });
    const byId = new Map(result.map((item) => [item.nodeId, item]));

    expect(byId.get('jmm')!.y).toBeLessThan(430);
    expect(byId.get('jmm')!.y).toBeGreaterThan(260);
    expect(byId.get('jmm')!.y).toBeLessThan(byId.get('jmm')!.compactY - 800);
    expect(byId.get('other-d')!.y).toBeLessThan(byId.get('jmm')!.y);
    expect(byId.get('jmm')!.y - byId.get('other-d')!.y).toBeLessThan(320);
  });

  it('treats directly generated children as title-anchor annotation relations', () => {
    const nodes = [node('parent'), node('generated-child', 'parent', true)];
    const columns = [column('depth-0', 0, ['parent']), column('depth-1', 1, ['generated-child'])];
    const pageLayouts = {
      parent: layout('parent', 'depth-0', 0, 0, 420, 260),
      'generated-child': layout('generated-child', 'depth-1', 1, 0, 52, 180),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [],
      focusNodeId: 'parent',
      viewportHeight: 720,
      anchors: anchorRegistry({
        annotations: { 'title-anchor:parent:generated-child': { nodeId: 'parent', center: 24, targetNodeId: 'generated-child' } },
      }),
    });

    expect(result.find((item) => item.nodeId === 'generated-child')!.y).toBeGreaterThan(180);
  });

  it('lets non-focused annotation relations exert ambient layout force', () => {
    const nodes = [node('focus'), node('ambient-source'), node('target')];
    const columns = [column('depth-0', 0, ['focus', 'ambient-source']), column('depth-1', 1, ['target'])];
    const pageLayouts = {
      focus: layout('focus', 'depth-0', 0, 0, 52),
      'ambient-source': layout('ambient-source', 'depth-0', 0, 1, 420, 240),
      target: layout('target', 'depth-1', 1, 0, 52),
    };

    const result = computeElasticTiledLayouts({
      columns,
      pageLayouts,
      nodes,
      edges: [],
      annotations: [annotation('ambient-target', 'ambient-source', 'target')],
      focusNodeId: 'focus',
      viewportHeight: 720,
      anchors: anchorRegistry({
        annotations: { 'ambient-target': { nodeId: 'ambient-source', center: 180, targetNodeId: 'target' } },
      }),
    });

    expect(result.find((item) => item.nodeId === 'target')!.y).toBeGreaterThan(260);
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
      struct: layout('struct', 'depth-0', 0, 0, 0, 486),
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
    expect(byId.get('child-29')!.y).toBeCloseTo(byId.get('child-29')!.compactY);
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

    expect(byId.get('parent')!.y).toBeCloseTo(byId.get('parent')!.compactY);
    expect(byId.get('child-29')!.y).toBeCloseTo(byId.get('child-29')!.compactY);
  });
});
