import { describe, expect, it } from 'vitest';
import type { RhizoEdge, RhizoNode, RhizoWorkspace } from './types.js';
import { validateFlow } from './schemas.js';
import {
  DEFAULT_TILED_COLUMN_WIDTH,
  DEFAULT_TILED_COLUMN_HEADER_HEIGHT,
  DEFAULT_TILED_WORKSPACE_ID,
  MIN_TILED_COLUMN_WIDTH,
  createDefaultTiledWorkspace,
  normalizeTiledWorkspaces,
  projectTiledColumns,
} from './workspace.js';

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

describe('tiled workspace projection', () => {
  it('creates a default depth workspace from graph edges', () => {
    const nodes = [node('node-root'), node('a'), node('b'), node('c'), node('orphan')];
    const edges = [edge('node-root', 'a'), edge('a', 'b'), edge('node-root', 'c')];

    const workspace = createDefaultTiledWorkspace(nodes, edges, '2026-01-01T00:00:00.000Z');

    expect(workspace.id).toBe(DEFAULT_TILED_WORKSPACE_ID);
    expect(workspace.projection).toEqual({ mode: 'depth', includeOrphans: true });
    expect(workspace.columns.map((column) => ({ depth: column.depth, pageIds: column.pageIds }))).toEqual([
      { depth: 0, pageIds: ['node-root', 'orphan'] },
      { depth: 1, pageIds: ['a', 'c'] },
      { depth: 2, pageIds: ['b'] },
    ]);
  });

  it('uses the minimum reachable depth for DAG nodes', () => {
    const nodes = [node('node-root'), node('a'), node('b')];
    const edges = [edge('node-root', 'a'), edge('a', 'b'), edge('node-root', 'b')];

    const projection = projectTiledColumns(nodes, edges);

    expect(projection.depths).toEqual({ 'node-root': 0, a: 1, b: 1 });
    expect(projection.columns.map((column) => column.pageIds)).toEqual([['node-root'], ['a', 'b']]);
  });

  it('can exclude orphan nodes from depth projection', () => {
    const nodes = [node('node-root'), node('a'), node('orphan')];
    const edges = [edge('node-root', 'a')];

    const projection = projectTiledColumns(nodes, edges, { projection: { mode: 'depth', includeOrphans: false } });

    expect(projection.orphanNodeIds).toEqual(['orphan']);
    expect(projection.columns.map((column) => column.pageIds)).toEqual([['node-root'], ['a']]);
  });

  it('preserves valid persisted column order and appends new nodes', () => {
    const nodes = [node('node-root'), node('a'), node('b'), node('c')];
    const edges = [edge('node-root', 'a'), edge('node-root', 'b'), edge('node-root', 'c')];
    const persistedWorkspace = {
      projection: { mode: 'depth', includeOrphans: true },
      columns: [
        { id: 'custom-depth-1', depth: 1, width: 10, pageIds: ['missing', 'b', 'a', 'b'] },
      ],
    } as Pick<RhizoWorkspace, 'projection' | 'columns'>;

    const projection = projectTiledColumns(nodes, edges, persistedWorkspace);
    const depthOne = projection.columns.find((column) => column.depth === 1);

    expect(depthOne?.id).toBe('custom-depth-1');
    expect(depthOne?.width).toBe(MIN_TILED_COLUMN_WIDTH);
    expect(depthOne?.pageIds).toEqual(['b', 'a', 'c']);
  });

  it('keeps columns tied to graph depth while preserving order inside a depth', () => {
    const nodes = [node('node-root'), node('a'), node('b')];
    const edges = [edge('node-root', 'a'), edge('node-root', 'b')];
    const persistedWorkspace = {
      projection: { mode: 'depth', includeOrphans: true },
      columns: [
        { id: 'depth-1', depth: 1, width: 420, pageIds: ['b'] },
        { id: 'wrong-depth', depth: 2, width: 420, pageIds: ['a'] },
      ],
    } as Pick<RhizoWorkspace, 'projection' | 'columns'>;

    const projection = projectTiledColumns(nodes, edges, persistedWorkspace);

    expect(projection.depths).toEqual({ 'node-root': 0, a: 1, b: 1 });
    expect(projection.columns.map((column) => ({ depth: column.depth, pageIds: column.pageIds }))).toEqual([
      { depth: 0, pageIds: ['node-root'] },
      { depth: 1, pageIds: ['b', 'a'] },
    ]);
  });
});

describe('tiled workspace normalization', () => {
  it('normalizes optional workspace state in validated flows', () => {
    const flow = validateFlow({
      name: 'workspace-demo',
      nodes: [node('node-root'), node('a'), node('b')],
      edges: [edge('node-root', 'a'), edge('node-root', 'b')],
      activeWorkspaceId: 'study',
      workspaces: [
        {
          id: 'study',
          name: 'Study',
          kind: 'tiled',
          projection: { mode: 'depth', includeOrphans: true },
          columns: [{ depth: 1, width: 9999, pageIds: ['b', 'missing', 'a'] }],
          pages: {
            a: { display: 'title', height: 10, scrollTop: -20, pinned: true },
            missing: { display: 'normal', height: 300, scrollTop: 0 },
          },
          floating: [
            { nodeId: 'b', width: 100, height: 99999, zIndex: 5, display: 'expanded' },
            { nodeId: 'missing', width: 420, height: 360, zIndex: 6, display: 'normal' },
          ],
          focus: { region: 'columns', nodeId: 'a', columnId: 'depth-1' },
        },
      ],
    });

    expect(flow.activeWorkspaceId).toBe('study');
    expect(flow.workspaces).toHaveLength(1);
    expect(flow.workspaces?.[0].columns.find((column) => column.depth === 1)?.pageIds).toEqual(['b', 'a']);
    expect(flow.workspaces?.[0].columns.find((column) => column.depth === 1)?.width).toBe(900);
    expect(flow.workspaces?.[0].pages).toEqual({
      a: { nodeId: 'a', display: 'title', height: 64, scrollTop: 0, pinned: true },
    });
    expect(flow.workspaces?.[0].floating).toEqual([
      { nodeId: 'b', width: MIN_TILED_COLUMN_WIDTH, height: 2400, x: undefined, y: undefined, zIndex: 5, display: 'expanded' },
    ]);
    expect(flow.workspaces?.[0].focus).toEqual({ workspaceId: 'study', region: 'columns', columnId: 'depth-1', nodeId: 'a' });
  });

  it('does not add workspace fields to legacy flows without workspaces', () => {
    const flow = validateFlow({
      nodes: [node('node-root')],
      edges: [],
    });

    expect(flow.workspaces).toBeUndefined();
    expect(flow.activeWorkspaceId).toBeUndefined();
  });

  it('normalizes multiple workspaces and falls back active workspace id', () => {
    const nodes = [node('node-root')];
    const edges: RhizoEdge[] = [];

    const state = normalizeTiledWorkspaces([
      { id: 'same', kind: 'tiled' },
      { id: 'same', kind: 'tiled' },
    ], { nodes, edges, activeWorkspaceId: 'missing' });

    expect(state.activeWorkspaceId).toBe('same');
    expect(state.workspaces.map((workspace) => workspace.id)).toEqual(['same', 'same-2']);
    expect(state.workspaces[0].columns[0].width).toBe(DEFAULT_TILED_COLUMN_WIDTH);
  });

  it('builds continuous tiling-stack layouts from per-depth order', () => {
    const nodes = [node('node-root'), node('a'), node('b')];
    const edges = [edge('node-root', 'a'), edge('node-root', 'b')];

    const state = normalizeTiledWorkspaces([
      {
        id: 'field',
        kind: 'tiled',
        columns: [{ id: 'depth-1', depth: 1, width: 420, pageIds: ['b', 'a'] }],
        pages: {
          b: { height: 180, display: 'normal' },
          a: { height: 120, display: 'normal' },
        },
      },
    ], { nodes, edges, activeWorkspaceId: 'field' });

    const workspace = state.workspaces[0];
    expect(workspace.kind).toBe('bottomless-tiled');
    const projection = projectTiledColumns(nodes, edges, workspace);
    expect(projection.columns.find((column) => column.depth === 1)?.pageIds).toEqual(['b', 'a']);
    expect(projection.pageLayouts.b).toMatchObject({ depth: 1, order: 0, y: DEFAULT_TILED_COLUMN_HEADER_HEIGHT, height: 180 });
    expect(projection.pageLayouts.a).toMatchObject({ depth: 1, order: 1, y: DEFAULT_TILED_COLUMN_HEADER_HEIGHT + 180, height: 120 });
  });
});
