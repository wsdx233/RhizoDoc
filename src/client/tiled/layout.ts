import { DEFAULT_TILED_LANE_GAP } from '../../shared/workspace.js';
import { measureTiledAnchors } from './anchors.js';
import { computeElasticTiledLayouts } from './context-layout.js';
import { buildTiledRelationIndex } from './relation-index.js';

const TILED_FIELD_PADDING_X = 20;
const TILED_MIN_VERTICAL_SCROLL_SLACK = 360;

type TiledLayoutControllerOptions = {
  root: HTMLElement;
  state: any;
  getNode: (id: string) => any;
};

export function createTiledLayoutController(options: TiledLayoutControllerOptions) {
  const { root, state } = options;

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

  function getAnchors(projection, workspace) {
    const focusedId = workspace.focus?.nodeId || '';
    const focusedLayout = focusedId ? projection.pageLayouts[focusedId] : null;
    return measureTiledAnchors({
      root,
      focusNodeId: focusedId,
      focusedLayout,
      annotations: getFocusRelatedAnnotations(focusedId),
    });
  }

  function getFocusRelatedAnnotations(focusedId: string) {
    const annotations = state.annotations || [];
    if (!focusedId) return [];
    return annotations.filter((annotation) => annotation.sourceNodeId === focusedId || annotation.targetNodeId === focusedId);
  }

  function getContextualLayouts(projection, workspace) {
    const relationIndex = buildTiledRelationIndex(state.nodes, state.edges, state.annotations);
    return computeElasticTiledLayouts({
      columns: projection.columns || [],
      pageLayouts: projection.pageLayouts || {},
      nodes: state.nodes || [],
      edges: state.edges || [],
      annotations: state.annotations || [],
      relationIndex,
      focusNodeId: workspace.focus?.nodeId || '',
      viewportHeight: root.clientHeight || 720,
      anchors: getAnchors(projection, workspace),
      mode: 'canonical',
    });
  }

  return {
    getCurrentFieldOffsetY,
    getFieldGeometry,
    getContextualLayouts,
  };
}
