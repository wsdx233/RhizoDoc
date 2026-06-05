import type { RhizoAnnotation, RhizoEdge, RhizoNode } from '../../shared/types.js';

export type TiledRelationKind = 'annotation' | 'structural' | 'sibling';

export type TiledRelationCandidate = {
  sourceId: string;
  targetId: string;
  kind: TiledRelationKind;
  weight: number;
  annotationId?: string;
  annotationDirection?: 'source-to-target' | 'target-to-source';
  annotationAnchorKind?: 'text' | 'title';
  structuralDirection?: 'parent-to-child' | 'child-to-parent';
};

export type TiledRelationIndex = {
  nodeIds: Set<string>;
  parentByNodeId: Map<string, string>;
  childrenByParentId: Map<string, string[]>;
  directCandidatesByTargetId: Map<string, TiledRelationCandidate[]>;
};

export const TILED_TITLE_ANCHOR_PREFIX = 'title-anchor';

const ANNOTATION_WEIGHT = 160;
const TITLE_ANCHOR_WEIGHT = 118;
const STRUCTURAL_WEIGHT = 120;
const SIBLING_WEIGHT = 35;

export function getTiledTitleAnchorId(sourceId: string, targetId: string): string {
  return `${TILED_TITLE_ANCHOR_PREFIX}:${sourceId}:${targetId}`;
}

export function isTiledTitleAnchorId(annotationId = ''): boolean {
  return annotationId.startsWith(`${TILED_TITLE_ANCHOR_PREFIX}:`);
}

export function buildTiledRelationIndex(
  nodes: RhizoNode[] = [],
  edges: RhizoEdge[] = [],
  annotations: RhizoAnnotation[] = [],
): TiledRelationIndex {
  const nodeIds = new Set(nodes.map((node) => node.id).filter(Boolean));
  const parentByNodeId = new Map<string, string>();
  const childrenByParentId = new Map<string, string[]>();
  const directCandidateMaps = new Map<string, Map<string, TiledRelationCandidate>>();

  const addCandidate = (candidate: TiledRelationCandidate) => {
    if (!isVisiblePair(candidate.sourceId, candidate.targetId, nodeIds)) return;
    const targetMap = directCandidateMaps.get(candidate.targetId) || new Map<string, TiledRelationCandidate>();
    directCandidateMaps.set(candidate.targetId, targetMap);
    const key = `${candidate.kind}:${candidate.sourceId}:${candidate.annotationId || ''}`;
    const existing = targetMap.get(key);
    if (!existing || candidate.weight > existing.weight) targetMap.set(key, candidate);
  };

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const parentId = typeof node.parentId === 'string' ? node.parentId : '';
    if (!parentId || !nodeIds.has(parentId) || parentId === node.id) continue;
    parentByNodeId.set(node.id, parentId);
    const children = childrenByParentId.get(parentId) || [];
    children.push(node.id);
    childrenByParentId.set(parentId, children);
  }

  for (const [parentId, childIds] of childrenByParentId.entries()) {
    for (const childId of childIds) {
      const child = nodeById.get(childId);
      addBidirectionalStructuralCandidate(addCandidate, parentId, childId, STRUCTURAL_WEIGHT);
      if (child?.generated) {
        addTitleAnchorCandidate(addCandidate, parentId, childId);
      }
    }
  }

  for (const edge of edges) {
    addBidirectionalStructuralCandidate(addCandidate, edge.sourceId, edge.targetId, STRUCTURAL_WEIGHT);
  }

  for (const annotation of annotations) {
    if (!annotation.id) continue;
    addCandidate({
      sourceId: annotation.sourceNodeId,
      targetId: annotation.targetNodeId,
      kind: 'annotation',
      weight: ANNOTATION_WEIGHT,
      annotationId: annotation.id,
      annotationDirection: 'source-to-target',
      annotationAnchorKind: 'text',
    });
    addCandidate({
      sourceId: annotation.targetNodeId,
      targetId: annotation.sourceNodeId,
      kind: 'annotation',
      weight: ANNOTATION_WEIGHT - 10,
      annotationId: annotation.id,
      annotationDirection: 'target-to-source',
      annotationAnchorKind: 'text',
    });
  }

  return {
    nodeIds,
    parentByNodeId,
    childrenByParentId,
    directCandidatesByTargetId: new Map([...directCandidateMaps.entries()].map(([targetId, candidates]) => [targetId, [...candidates.values()]])),
  };
}

export function getTiledRelationCandidates(
  index: TiledRelationIndex,
  targetId: string,
  focusNodeId = '',
): TiledRelationCandidate[] {
  const candidates = [...(index.directCandidatesByTargetId.get(targetId) || [])];
  const targetParentId = index.parentByNodeId.get(targetId) || '';
  const focusParentId = focusNodeId ? index.parentByNodeId.get(focusNodeId) || '' : '';
  if (focusNodeId && focusNodeId !== targetId && targetParentId && targetParentId === focusParentId) {
    candidates.push({ sourceId: focusNodeId, targetId, kind: 'sibling', weight: SIBLING_WEIGHT });
  }
  return candidates;
}

function addTitleAnchorCandidate(
  addCandidate: (candidate: TiledRelationCandidate) => void,
  sourceId: string,
  targetId: string,
) {
  const annotationId = getTiledTitleAnchorId(sourceId, targetId);
  addCandidate({
    sourceId,
    targetId,
    kind: 'annotation',
    weight: TITLE_ANCHOR_WEIGHT,
    annotationId,
    annotationDirection: 'source-to-target',
    annotationAnchorKind: 'title',
  });
  addCandidate({
    sourceId: targetId,
    targetId: sourceId,
    kind: 'annotation',
    weight: TITLE_ANCHOR_WEIGHT - 10,
    annotationId,
    annotationDirection: 'target-to-source',
    annotationAnchorKind: 'title',
  });
}

function addBidirectionalStructuralCandidate(
  addCandidate: (candidate: TiledRelationCandidate) => void,
  sourceId: string,
  targetId: string,
  weight: number,
) {
  addCandidate({ sourceId, targetId, kind: 'structural', weight, structuralDirection: 'parent-to-child' });
  addCandidate({ sourceId: targetId, targetId: sourceId, kind: 'structural', weight: weight - 10, structuralDirection: 'child-to-parent' });
}

function isVisiblePair(sourceId: string, targetId: string, nodeIds: Set<string>) {
  return Boolean(sourceId && targetId && sourceId !== targetId && nodeIds.has(sourceId) && nodeIds.has(targetId));
}
