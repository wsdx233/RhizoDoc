import { describe, expect, it } from 'vitest';
import type { RhizoAnnotation, RhizoEdge, RhizoNode } from '../../shared/types.js';
import { buildTiledRelationIndex, getTiledRelationCandidates } from './relation-index.js';

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

describe('tiled relation index', () => {
  it('indexes structural and annotation candidates without scanning all pairs', () => {
    const index = buildTiledRelationIndex(
      [node('root'), node('a', 'root'), node('b', 'root')],
      [edge('a', 'b')],
      [annotation('note', 'root', 'b')],
    );

    expect(getTiledRelationCandidates(index, 'b').map((candidate) => candidate.kind)).toContain('annotation');
    expect(getTiledRelationCandidates(index, 'b').map((candidate) => candidate.kind)).toContain('structural');
    expect(getTiledRelationCandidates(index, 'b', 'a').map((candidate) => candidate.kind)).toContain('sibling');
  });

  it('ignores relations that reference missing nodes', () => {
    const index = buildTiledRelationIndex(
      [node('root')],
      [edge('root', 'missing')],
      [annotation('bad', 'missing', 'root')],
    );

    expect(getTiledRelationCandidates(index, 'root')).toEqual([]);
  });
});
