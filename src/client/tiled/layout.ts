import { DEFAULT_TILED_LANE_GAP } from '../../shared/workspace.js';
import { clamp, cssAttr } from '../utils.js';

const TILED_FIELD_PADDING_X = 20;
const TILED_MIN_VERTICAL_SCROLL_SLACK = 360;

type TiledLayoutControllerOptions = {
  root: HTMLElement;
  state: any;
  getNode: (id: string) => any;
};

export function createTiledLayoutController(options: TiledLayoutControllerOptions) {
  const { root, state, getNode } = options;

  function getCurrentFieldOffsetY() {
    const field = root.querySelector('.tiled-field') as HTMLElement | null;
    return Number(field?.dataset.stackOffsetY || 0) || 0;
  }

  function getViewportVerticalSlack() {
    return (root.clientHeight || 0) + TILED_MIN_VERTICAL_SCROLL_SLACK;
  }

  function getFieldGeometry(columns, layouts) {
    const slack = getViewportVerticalSlack();
    const minY = Math.min(0, ...layouts.map((item) => item.y));
    const maxY = Math.max(0, ...layouts.map((item) => item.y + item.height));
    const fieldOffsetY = slack + Math.max(0, -minY);
    const fieldWidth = columns.reduce((x, column) => x + column.width + DEFAULT_TILED_LANE_GAP, 0) + TILED_FIELD_PADDING_X;
    const fieldHeight = fieldOffsetY + maxY + slack;
    return { fieldOffsetY, fieldWidth, fieldHeight };
  }

  function getFocusVisibleAnchor(baseFocusedLayout) {
    const section = root.querySelector(`[data-node-id="${cssAttr(baseFocusedLayout.nodeId)}"]`) as HTMLElement | null;
    if (!section) return baseFocusedLayout.height / 2;
    const sectionTop = section.offsetTop;
    const viewportTop = root.scrollTop;
    const viewportBottom = root.scrollTop + root.clientHeight;
    const visibleTop = Math.max(sectionTop, viewportTop);
    const visibleBottom = Math.min(sectionTop + section.offsetHeight, viewportBottom);
    if (visibleBottom <= visibleTop) return baseFocusedLayout.height / 2;
    return clamp((visibleTop + visibleBottom) / 2 - sectionTop, 0, baseFocusedLayout.height);
  }

  function getCandidateAnchor(candidateLayout, sourceAnchor) {
    return clamp(sourceAnchor, 0, candidateLayout.height);
  }

  function getContextualLayouts(projection, workspace) {
    const baseLayouts = Object.values(projection.pageLayouts) as any[];
    const focusedId = workspace.focus?.nodeId || '';
    const focusedLayout = focusedId ? projection.pageLayouts[focusedId] : null;
    if (!focusedLayout) return baseLayouts;

    const focusAnchor = getFocusVisibleAnchor(focusedLayout);
    const columns = projection.columns;
    const focusedColumnIndex = Math.max(0, columns.findIndex((column) => column.pageIds.includes(focusedId)));
    const offsetByColumnId = new Map();
    offsetByColumnId.set(columns[focusedColumnIndex]?.id, 0);

    for (let index = focusedColumnIndex; index < columns.length - 1; index += 1) {
      const leftColumn = columns[index];
      const rightColumn = columns[index + 1];
      const leftOffset = offsetByColumnId.get(leftColumn.id) || 0;
      offsetByColumnId.set(rightColumn.id, leftOffset + getAdjacentColumnDelta(leftColumn, rightColumn, projection, focusedId, focusAnchor));
    }

    for (let index = focusedColumnIndex; index > 0; index -= 1) {
      const rightColumn = columns[index];
      const leftColumn = columns[index - 1];
      const rightOffset = offsetByColumnId.get(rightColumn.id) || 0;
      offsetByColumnId.set(leftColumn.id, rightOffset - getAdjacentColumnDelta(leftColumn, rightColumn, projection, focusedId, focusAnchor));
    }

    return baseLayouts.map((item) => {
      const columnOffsetY = offsetByColumnId.get(item.columnId) || 0;
      return { ...item, y: item.y + columnOffsetY, columnOffsetY };
    });
  }

  function getAdjacentColumnDelta(leftColumn, rightColumn, projection, focusedId, focusAnchor) {
    const pair = selectAdjacentColumnPair(leftColumn, rightColumn, projection, focusedId);
    if (!pair) return 0;
    const sourceAnchor = getPairAnchor(pair.source, focusedId, focusAnchor);
    const targetAnchor = getCandidateAnchor(pair.target, sourceAnchor);
    return pair.source.y + sourceAnchor - pair.target.y - targetAnchor;
  }

  function selectAdjacentColumnPair(leftColumn, rightColumn, projection, focusedId) {
    let best = null;
    for (const leftNodeId of leftColumn.pageIds) {
      const leftLayout = projection.pageLayouts[leftNodeId];
      if (!leftLayout) continue;
      for (const rightNodeId of rightColumn.pageIds) {
        const rightLayout = projection.pageLayouts[rightNodeId];
        if (!rightLayout) continue;

        const score = getPairRelationScore(leftNodeId, rightNodeId, focusedId);
        if (score <= 0) continue;
        const distance = Math.abs(leftLayout.order - rightLayout.order);
        if (!best || score > best.score || (score === best.score && distance < best.distance)) {
          best = { source: leftLayout, target: rightLayout, score, distance };
        }
      }
    }
    return best;
  }

  function getPairAnchor(item, focusedId, focusAnchor) {
    return item.nodeId === focusedId ? focusAnchor : item.height / 2;
  }

  function getPairRelationScore(leftId, rightId, focusedId) {
    let score = getDirectedRelationScore(leftId, rightId);
    score = Math.max(score, getDirectedRelationScore(rightId, leftId) - 5);
    if (leftId === focusedId || rightId === focusedId) score += 30;
    return score;
  }

  function getDirectedRelationScore(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return 0;
    const source = getNode(sourceId);
    const target = getNode(targetId);
    if (!source || !target) return 0;
    let score = 0;
    if (state.annotations.some((annotation) => annotation.sourceNodeId === sourceId && annotation.targetNodeId === targetId)) score = Math.max(score, 120);
    if (state.edges.some((edge) => edge.sourceId === sourceId && edge.targetId === targetId) || target.parentId === sourceId) score = Math.max(score, 100);
    if (source.parentId && source.parentId === target.parentId) score = Math.max(score, 35);
    return score;
  }

  return {
    getCurrentFieldOffsetY,
    getFieldGeometry,
    getContextualLayouts,
  };
}
