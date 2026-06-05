import type { RhizoAnnotation, RhizoEdge, RhizoNode, TiledColumn, TiledPageLayout } from '../../shared/types.js';
import type { TiledAnchorRegistry, TiledLayoutAnchor } from './anchors.js';
import { fitElasticStack } from './elastic-layout.js';
import { getTiledFocusRelationPolicy, type TiledFocusRelationPolicy } from './focus-lens.js';
import { buildTiledRelationIndex, getTiledRelationCandidates, type TiledRelationCandidate, type TiledRelationIndex } from './relation-index.js';

export const TILED_ELASTIC_PANEL_GAP = 14;

const TILED_ELASTIC_BASE_WEIGHT = 18;
const TILED_ELASTIC_FOCUS_WEIGHT = 90;
const TILED_ELASTIC_INTERACTIVE_PREVIOUS_WEIGHT = 24;
const TILED_ELASTIC_RELATION_TOP_K = 4;
const TILED_ELASTIC_RELATION_WEIGHT_CAP = 280;
const TILED_ELASTIC_ACTIVE_RELATION_WEIGHT_CAP = 1800;
const TILED_ELASTIC_ANNOTATION_BASE_WEIGHT_MULTIPLIER = 0.16;
const TILED_ELASTIC_ANNOTATION_SPAN_WEIGHT_MULTIPLIER = 0.74;
const TILED_ELASTIC_ANNOTATION_BASE_MAX_DISPLACEMENT = 320;
const TILED_ELASTIC_ANNOTATION_SPAN_MIN_DISPLACEMENT = 180;
const TILED_ELASTIC_ANNOTATION_SPAN_MAX_DISPLACEMENT = 760;
const TILED_ELASTIC_ANNOTATION_MIN_SALIENCE = 0.012;
const TILED_ELASTIC_ACTIVE_ANNOTATION_MIN_SALIENCE = 0.32;
const TILED_ELASTIC_PASSES = 2;

type LayoutForceRole = 'compact' | 'focus' | 'interactive' | 'annotation-base' | 'annotation-span' | 'relation';
type RelationProposalRole = 'annotation-base' | 'annotation-span' | 'relation';

type LayoutForce = {
  y: number;
  weight: number;
  role: LayoutForceRole;
  active?: boolean;
};

type RelationProposal = {
  desiredY: number;
  weight: number;
  role: RelationProposalRole;
  active: boolean;
  candidate: TiledRelationCandidate;
  policy: RelationLayoutPolicy;
  definesRelationField?: boolean;
};

type RelationFieldObservation = {
  compactY: number;
  desiredY: number;
  weight: number;
  role: 'annotation-span';
};

type RelationField = {
  offsetAt: (compactY: number) => number;
  worldY: (compactY: number) => number;
};

type ColumnLayoutInput = {
  layout: ElasticTiledPageLayout;
  priorForces: LayoutForce[];
  relationProposals: RelationProposal[];
};

type ResolvedEndpointAnchor = {
  center: number;
  top: number;
  bottom: number;
};

type RelationLayoutPolicy = Pick<TiledFocusRelationPolicy, 'active' | 'displacement'> & {
  layoutWeight: number;
  maxDisplacement?: number;
};

export type ElasticTiledPageLayout = TiledPageLayout & {
  compactY: number;
  desiredY: number;
  computedGapBefore: number;
  extraGapBefore: number;
  relationPull: number;
  fieldOffset: number;
};

export type TiledAnchorMap = Record<string, number> | Map<string, number>;

export type ComputeElasticTiledLayoutsInput = {
  columns: TiledColumn[];
  pageLayouts: Record<string, TiledPageLayout> | TiledPageLayout[];
  nodes?: RhizoNode[];
  edges?: RhizoEdge[];
  annotations?: RhizoAnnotation[];
  relationIndex?: TiledRelationIndex;
  focusNodeId?: string;
  viewportHeight?: number;
  anchors?: TiledAnchorRegistry;
  previousY?: TiledAnchorMap;
  mode?: 'canonical' | 'interactive';
  minGap?: number;
  passes?: number;
};

export function computeElasticTiledLayouts(input: ComputeElasticTiledLayoutsInput): ElasticTiledPageLayout[] {
  const minGap = Math.max(0, finiteNumber(input.minGap, TILED_ELASTIC_PANEL_GAP));
  const columns = input.columns || [];
  const baseLayouts = createElasticBaseLayouts(normalizePageLayouts(input.pageLayouts), minGap);
  if (baseLayouts.length === 0 || columns.length === 0) return baseLayouts;

  const relationIndex = input.relationIndex || buildTiledRelationIndex(input.nodes || [], input.edges || [], input.annotations || []);
  const layoutsByNodeId = new Map(baseLayouts.map((layout) => [layout.nodeId, layout]));
  const layoutsByColumnId = new Map<string, ElasticTiledPageLayout[]>();
  for (const column of columns) {
    layoutsByColumnId.set(column.id, column.pageIds.map((nodeId) => layoutsByNodeId.get(nodeId)).filter(Boolean) as ElasticTiledPageLayout[]);
  }

  let solvedByNodeId = new Map(baseLayouts.map((layout) => [layout.nodeId, layout]));
  const passCount = Math.max(1, Math.floor(finiteNumber(input.passes, TILED_ELASTIC_PASSES)));
  for (let pass = 0; pass < passCount; pass += 1) {
    const snapshotByNodeId = solvedByNodeId;
    const nextByNodeId = new Map<string, ElasticTiledPageLayout>();
    for (const column of columns) {
      const layouts = layoutsByColumnId.get(column.id) || [];
      const solved = solveColumn(layouts, snapshotByNodeId, relationIndex, input, minGap);
      solved.forEach((layout) => nextByNodeId.set(layout.nodeId, layout));
    }
    solvedByNodeId = nextByNodeId;
  }

  return baseLayouts.map((layout) => solvedByNodeId.get(layout.nodeId) || layout);
}

function createElasticBaseLayouts(pageLayouts: TiledPageLayout[], minGap: number): ElasticTiledPageLayout[] {
  const compactYByColumnId = new Map<string, number>();
  const orderByColumnId = new Map<string, number>();
  return pageLayouts
    .slice()
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
    .map((layout) => {
      const order = orderByColumnId.get(layout.columnId) || 0;
      const compactY = compactYByColumnId.get(layout.columnId) ?? finiteNumber(layout.y, 0);
      orderByColumnId.set(layout.columnId, order + 1);
      compactYByColumnId.set(layout.columnId, compactY + Math.max(0, layout.height) + minGap);
      return {
        ...layout,
        y: compactY,
        compactY,
        desiredY: compactY,
        columnOffsetY: 0,
        computedGapBefore: order === 0 ? 0 : minGap,
        extraGapBefore: 0,
        relationPull: 0,
        fieldOffset: 0,
      };
    });
}

function solveColumn(
  layouts: ElasticTiledPageLayout[],
  snapshotByNodeId: Map<string, ElasticTiledPageLayout>,
  relationIndex: TiledRelationIndex,
  input: ComputeElasticTiledLayoutsInput,
  minGap: number,
): ElasticTiledPageLayout[] {
  if (layouts.length === 0) return [];
  const viewportHeight = Math.max(1, finiteNumber(input.viewportHeight, 720));
  const layoutInputs = layouts.map((layout) => buildColumnLayoutInput(layout, snapshotByNodeId, relationIndex, input, viewportHeight));
  const relationField = solveRelationField(collectRelationFieldObservations(layoutInputs));
  const items = layoutInputs.map((layoutInput) => {
    const forces = resolveLayoutForces(layoutInput, relationField, viewportHeight);
    const desiredY = weightedMean(forces);
    const totalWeight = forces.reduce((sum, force) => sum + force.weight, 0) || 1;
    return { id: layoutInput.layout.nodeId, height: layoutInput.layout.height, desiredY, weight: totalWeight };
  });

  const fitted = fitElasticStack(items, { minGap });
  const fittedByNodeId = new Map(fitted.map((item) => [item.id, item]));
  const desiredYByNodeId = new Map(items.map((item) => [item.id, item.desiredY]));
  return layouts.map((layout) => {
    const result = fittedByNodeId.get(layout.nodeId);
    if (!result) return layout;
    const desiredY = desiredYByNodeId.get(layout.nodeId) ?? layout.compactY;
    const fieldOffset = relationField.offsetAt(layout.compactY);
    return {
      ...layout,
      y: result.y,
      desiredY,
      computedGapBefore: result.gapBefore,
      extraGapBefore: result.extraGapBefore,
      relationPull: desiredY - layout.compactY,
      fieldOffset,
    };
  });
}

function buildColumnLayoutInput(
  layout: ElasticTiledPageLayout,
  snapshotByNodeId: Map<string, ElasticTiledPageLayout>,
  relationIndex: TiledRelationIndex,
  input: ComputeElasticTiledLayoutsInput,
  viewportHeight: number,
): ColumnLayoutInput {
  return {
    layout,
    priorForces: buildPriorForces(layout, input),
    relationProposals: selectRelationProposals(collectRelationProposals(layout, snapshotByNodeId, relationIndex, input, viewportHeight)),
  };
}

function buildPriorForces(layout: ElasticTiledPageLayout, input: ComputeElasticTiledLayoutsInput): LayoutForce[] {
  const focusNodeId = input.focusNodeId || '';
  const forces: LayoutForce[] = [{ y: layout.compactY, weight: TILED_ELASTIC_BASE_WEIGHT, role: 'compact' }];
  if (layout.nodeId === focusNodeId) forces.push({ y: layout.compactY, weight: TILED_ELASTIC_FOCUS_WEIGHT, role: 'focus' });

  if (input.mode === 'interactive') {
    const previousY = getAnchorValue(input.previousY, layout.nodeId);
    if (Number.isFinite(previousY)) {
      forces.push({ y: previousY, weight: TILED_ELASTIC_INTERACTIVE_PREVIOUS_WEIGHT, role: 'interactive' });
    }
  }
  return forces;
}

function selectRelationProposals(proposals: RelationProposal[]): RelationProposal[] {
  const activeProposals = proposals.filter((proposal) => proposal.active);
  const selected = (activeProposals.length > 0 ? activeProposals : proposals)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, activeProposals.length > 0 ? activeProposals.length : TILED_ELASTIC_RELATION_TOP_K);
  const relationWeight = selected.reduce((sum, proposal) => sum + proposal.weight, 0);
  const weightCap = activeProposals.length > 0 ? TILED_ELASTIC_ACTIVE_RELATION_WEIGHT_CAP : TILED_ELASTIC_RELATION_WEIGHT_CAP;
  const scale = relationWeight > weightCap ? weightCap / relationWeight : 1;
  return selected.map((proposal) => ({ ...proposal, weight: proposal.weight * scale }));
}

function collectRelationFieldObservations(layoutInputs: ColumnLayoutInput[]): RelationFieldObservation[] {
  return layoutInputs.flatMap(({ layout, relationProposals }) => relationProposals
    .filter((proposal) => proposal.definesRelationField)
    .map((proposal) => ({
      compactY: layout.compactY,
      desiredY: proposal.desiredY,
      weight: proposal.weight,
      role: 'annotation-span' as const,
    })));
}

function solveRelationField(observations: RelationFieldObservation[]): RelationField {
  const anchors = aggregateRelationFieldObservations(observations);
  if (anchors.length === 0) return zeroRelationField;

  return {
    offsetAt(compactY: number) {
      const previous = [...anchors].reverse().find((anchor) => anchor.compactY <= compactY);
      const next = anchors.find((anchor) => anchor.compactY >= compactY);
      if (!previous) return next?.offset || 0;
      if (!next) return previous.offset;
      if (previous.compactY === next.compactY) return previous.offset;
      const t = (compactY - previous.compactY) / (next.compactY - previous.compactY);
      return previous.offset + (next.offset - previous.offset) * t;
    },
    worldY(compactY: number) {
      return compactY + this.offsetAt(compactY);
    },
  };
}

const zeroRelationField: RelationField = {
  offsetAt: () => 0,
  worldY: (compactY) => compactY,
};

function aggregateRelationFieldObservations(observations: RelationFieldObservation[]) {
  const byCompactY = new Map<number, { compactY: number; weightedOffset: number; weight: number }>();
  for (const observation of observations) {
    const weight = Math.max(0, finiteNumber(observation.weight, 0));
    if (weight <= 0) continue;
    const offset = observation.desiredY - observation.compactY;
    const existing = byCompactY.get(observation.compactY) || { compactY: observation.compactY, weightedOffset: 0, weight: 0 };
    existing.weightedOffset += offset * weight;
    existing.weight += weight;
    byCompactY.set(observation.compactY, existing);
  }
  return [...byCompactY.values()]
    .map((anchor) => ({ compactY: anchor.compactY, offset: anchor.weightedOffset / (anchor.weight || 1), weight: anchor.weight }))
    .sort((a, b) => a.compactY - b.compactY);
}

function resolveLayoutForces(layoutInput: ColumnLayoutInput, relationField: RelationField, viewportHeight: number): LayoutForce[] {
  const fieldBaseY = relationField.worldY(layoutInput.layout.compactY);
  return [
    ...layoutInput.priorForces.map((force) => force.role === 'compact' ? { ...force, y: fieldBaseY } : force),
    ...layoutInput.relationProposals.map((proposal) => resolveRelationProposal(proposal, fieldBaseY, viewportHeight)),
  ];
}

function resolveRelationProposal(proposal: RelationProposal, referenceY: number, viewportHeight: number): LayoutForce {
  return {
    y: clampDesiredY(proposal.desiredY, referenceY, proposal.candidate, proposal.policy, viewportHeight),
    weight: proposal.weight,
    role: proposal.role,
    active: proposal.active,
  };
}

function collectRelationProposals(
  layout: ElasticTiledPageLayout,
  snapshotByNodeId: Map<string, ElasticTiledPageLayout>,
  relationIndex: TiledRelationIndex,
  input: ComputeElasticTiledLayoutsInput,
  viewportHeight: number,
): RelationProposal[] {
  const focusNodeId = input.focusNodeId || '';
  if (layout.nodeId === focusNodeId) return [];
  const candidates = getTiledRelationCandidates(relationIndex, layout.nodeId, focusNodeId);
  const proposals: RelationProposal[] = [];

  for (const candidate of candidates) {
    const source = snapshotByNodeId.get(candidate.sourceId);
    if (!source || source.columnId === layout.columnId) continue;
    const policy = getTiledFocusRelationPolicy(candidate, focusNodeId);
    if (!policy.participatesInLayout) continue;

    if (candidate.kind === 'annotation') {
      proposals.push(...collectAnnotationRelationProposals(source, layout, candidate, policy, input.anchors));
      continue;
    }

    const sourceAnchor = resolveNodeAnchor(source, input.anchors);
    const targetAnchor = resolveNodeAnchor(layout, input.anchors);
    proposals.push({
      desiredY: source.y + sourceAnchor.center - targetAnchor.center,
      weight: policy.layoutWeight,
      role: 'relation',
      active: policy.active,
      candidate,
      policy,
    });
  }

  return proposals;
}

function clampDesiredY(
  desiredY: number,
  referenceY: number,
  candidate: TiledRelationCandidate,
  policy: RelationLayoutPolicy,
  viewportHeight: number,
): number {
  if (policy.displacement === 'exact') return desiredY;
  if (policy.displacement === 'none') return referenceY;
  const kindMultiplier = candidate.kind === 'annotation'
    ? 0.9
    : candidate.kind === 'structural'
      ? 0.65
      : 0.35;
  const activeMultiplier = policy.active ? 1.15 : 1;
  const maxDisplacement = policy.maxDisplacement ?? Math.max(240, viewportHeight * kindMultiplier * activeMultiplier);
  return Math.min(Math.max(desiredY, referenceY - maxDisplacement), referenceY + maxDisplacement);
}

function collectAnnotationRelationProposals(
  source: ElasticTiledPageLayout,
  target: ElasticTiledPageLayout,
  candidate: TiledRelationCandidate,
  policy: TiledFocusRelationPolicy,
  anchors: TiledAnchorRegistry | undefined,
): RelationProposal[] {
  const proposals: RelationProposal[] = [];
  const sourceBaseAnchor = resolveNodeAnchor(source, anchors);
  const targetBaseAnchor = resolveNodeAnchor(target, anchors);
  const inactiveLayoutWeight = policy.active ? candidate.weight : policy.layoutWeight;
  const basePolicy: RelationLayoutPolicy = {
    active: false,
    displacement: 'bounded',
    layoutWeight: inactiveLayoutWeight * TILED_ELASTIC_ANNOTATION_BASE_WEIGHT_MULTIPLIER,
    maxDisplacement: TILED_ELASTIC_ANNOTATION_BASE_MAX_DISPLACEMENT,
  };
  proposals.push({
    desiredY: source.y + sourceBaseAnchor.center - targetBaseAnchor.center,
    weight: basePolicy.layoutWeight,
    role: 'annotation-base',
    active: false,
    candidate,
    policy: basePolicy,
  });

  const annotationAnchor = getEndpointAnnotationAnchor(source, candidate, anchors)
    ?? getEndpointAnnotationAnchor(target, candidate, anchors);
  if (!annotationAnchor) return proposals;

  const salience = getAnnotationAnchorSalience(annotationAnchor);
  if (salience <= TILED_ELASTIC_ANNOTATION_MIN_SALIENCE) return proposals;

  const sourceSpanAnchor = annotationAnchor.nodeId === source.nodeId
    ? anchorFromLayoutAnchor(source, annotationAnchor)
    : sourceBaseAnchor;
  const targetSpanAnchor = annotationAnchor.nodeId === target.nodeId
    ? anchorFromLayoutAnchor(target, annotationAnchor)
    : targetBaseAnchor;
  const definesRelationField = candidate.annotationAnchorKind !== 'title'
    && annotationAnchor.visibility === 'visible'
    && salience >= TILED_ELASTIC_ACTIVE_ANNOTATION_MIN_SALIENCE;
  const spanActive = policy.active && definesRelationField;
  const spanPolicy: RelationLayoutPolicy = {
    active: spanActive,
    displacement: spanActive ? policy.displacement : 'bounded',
    layoutWeight: (spanActive ? policy.layoutWeight : inactiveLayoutWeight) * TILED_ELASTIC_ANNOTATION_SPAN_WEIGHT_MULTIPLIER * salience,
    maxDisplacement: spanActive ? undefined : lerp(TILED_ELASTIC_ANNOTATION_SPAN_MIN_DISPLACEMENT, TILED_ELASTIC_ANNOTATION_SPAN_MAX_DISPLACEMENT, salience),
  };
  proposals.push({
    desiredY: source.y + sourceSpanAnchor.center - targetSpanAnchor.center,
    weight: spanPolicy.layoutWeight,
    role: 'annotation-span',
    active: spanPolicy.active,
    candidate,
    policy: spanPolicy,
    definesRelationField,
  });
  return proposals;
}

function resolveNodeAnchor(layout: ElasticTiledPageLayout, anchors: TiledAnchorRegistry | undefined): ResolvedEndpointAnchor {
  const nodeAnchor = anchors?.nodeAnchors[layout.nodeId];
  if (!nodeAnchor) {
    const center = clampAnchor(undefined, layout.height);
    return { center, top: 0, bottom: Math.max(0, layout.height) };
  }
  return anchorFromLayoutAnchor(layout, nodeAnchor);
}

function getEndpointAnnotationAnchor(
  layout: ElasticTiledPageLayout,
  candidate: TiledRelationCandidate,
  anchors: TiledAnchorRegistry | undefined,
): TiledLayoutAnchor | undefined {
  if (!candidate.annotationId) return undefined;
  const annotationAnchor = anchors?.annotationAnchors[candidate.annotationId];
  return annotationAnchor?.nodeId === layout.nodeId ? annotationAnchor : undefined;
}

function anchorFromLayoutAnchor(layout: ElasticTiledPageLayout, anchor: TiledLayoutAnchor): ResolvedEndpointAnchor {
  return {
    center: clampAnchor(anchor.center, layout.height),
    top: clampAnchor(anchor.top, layout.height),
    bottom: clampAnchor(anchor.bottom, layout.height),
  };
}

function getAnnotationAnchorSalience(anchor: TiledLayoutAnchor): number {
  const value = finiteNumber(anchor.salience, NaN);
  if (Number.isFinite(value)) return Math.min(Math.max(value, 0), 1);
  if (anchor.visibility === 'visible') return 1;
  const offscreenDistance = finiteNumber(anchor.offscreenDistance, 0);
  return Math.exp(-((offscreenDistance / 260) ** 2));
}

function clampAnchor(value: unknown, height: number): number {
  const fallback = height / 2;
  const anchor = finiteNumber(value, fallback);
  return Math.min(Math.max(anchor, 0), height);
}

function weightedMean(targets: { y: number; weight: number }[]): number {
  const totalWeight = targets.reduce((sum, target) => sum + target.weight, 0) || 1;
  return targets.reduce((sum, target) => sum + target.y * target.weight, 0) / totalWeight;
}

function getAnchorValue(anchors: TiledAnchorMap | undefined, nodeId: string): number {
  if (!anchors) return NaN;
  const value = anchors instanceof Map ? anchors.get(nodeId) : anchors[nodeId];
  return finiteNumber(value, NaN);
}

function normalizePageLayouts(pageLayouts: Record<string, TiledPageLayout> | TiledPageLayout[]): TiledPageLayout[] {
  return Array.isArray(pageLayouts) ? pageLayouts : Object.values(pageLayouts || {});
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * Math.min(Math.max(t, 0), 1);
}

function finiteNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
