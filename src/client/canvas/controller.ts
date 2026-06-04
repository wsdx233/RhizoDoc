import { clamp } from '../utils.js';
import { drawCanvasEdges } from './edges.js';
import { centerCanvasFromMinimapPointer, updateCanvasMinimap } from './minimap.js';
import { NODE_FALLBACK_HEIGHT, NODE_WIDTH } from './constants.js';
import {
  fitCanvasToBounds,
  findSafeCanvasPosition,
  findSmartCanvasChildPosition,
  getCanvasGraphBounds,
  getCanvasNodeRect,
  getCanvasNodeSize,
  getVisibleCanvasBounds,
  screenToCanvasPoint,
} from './geometry.js';

export function createCanvasWorkspaceController(options: {
  dom: any;
  state: any;
  getNode: (id: string) => any;
}) {
  const { dom, state, getNode } = options;

  function updateTransform() {
    dom.canvas.style.transform = `translate(${state.canvas.x}px, ${state.canvas.y}px) scale(${state.canvas.scale})`;
    dom.viewport.style.backgroundPosition = `${state.canvas.x}px ${state.canvas.y}px`;
    dom.viewport.style.backgroundSize = `${40 * state.canvas.scale}px ${40 * state.canvas.scale}px`;
    updateMinimap();
  }

  function drawEdges() {
    drawCanvasEdges({ edgesLayer: dom.edgesLayer, nodes: state.nodes, edges: state.edges, getNodeSize });
  }

  function updateMinimap() {
    state.minimapBounds = updateCanvasMinimap({
      minimap: dom.minimap,
      minimapContent: dom.minimapContent,
      minimapViewport: dom.minimapViewport,
      nodes: state.nodes,
      canvas: state.canvas,
      getGraphBounds,
      getNodeSize,
    });
  }

  function zoom(delta: number, mouseX: number, mouseY: number) {
    const oldScale = state.canvas.scale;
    const newScale = clamp(oldScale + delta, 0.18, 3);
    const rect = dom.viewport.getBoundingClientRect();
    const mx = mouseX - rect.left;
    const my = mouseY - rect.top;
    state.canvas.x = mx - (mx - state.canvas.x) * (newScale / oldScale);
    state.canvas.y = my - (my - state.canvas.y) * (newScale / oldScale);
    state.canvas.scale = newScale;
    updateTransform();
  }

  function zoomFit() {
    if (state.nodes.length === 0) return;
    state.canvas = { ...state.canvas, ...fitCanvasToBounds(state.canvas, getGraphBounds(80)) };
    updateTransform();
  }

  function center() {
    state.canvas.x = window.innerWidth / 2;
    state.canvas.y = window.innerHeight / 2;
    updateTransform();
  }

  function focusNode(id: string) {
    const node = getNode(id);
    const nodeEl = document.getElementById(id);
    if (!node || !nodeEl) return;
    const width = nodeEl.offsetWidth || NODE_WIDTH;
    const height = nodeEl.offsetHeight || NODE_FALLBACK_HEIGHT;
    state.canvas.x = window.innerWidth / 2 - (node.x + width / 2) * state.canvas.scale;
    state.canvas.y = window.innerHeight / 2 - (node.y + height / 2) * state.canvas.scale;
    updateTransform();
    nodeEl.classList.remove('focused');
    void nodeEl.offsetWidth;
    nodeEl.classList.add('focused');
  }

  function screenToCanvas(clientX: number, clientY: number) {
    return screenToCanvasPoint(clientX, clientY, dom.viewport, state.canvas);
  }

  function getNodeSize(node: any) {
    return getCanvasNodeSize(node, document.getElementById(node?.id));
  }

  function getNodeRect(node: any) {
    return getCanvasNodeRect(node, getNodeSize(node));
  }

  function getGraphBounds(padding = 0) {
    return getCanvasGraphBounds(state.nodes, padding, getNodeSize);
  }

  function getVisibleBounds() {
    return getVisibleCanvasBounds(state.canvas);
  }

  function findSmartChildPosition(parent: any, targetWidth = NODE_WIDTH) {
    return findSmartCanvasChildPosition(state.nodes, parent, {
      targetWidth,
      targetHeight: NODE_FALLBACK_HEIGHT,
      getNodeSize,
      viewport: getVisibleBounds(),
    });
  }

  function findSafePosition(startX: number, startY: number, width = NODE_WIDTH, height = NODE_FALLBACK_HEIGHT) {
    return findSafeCanvasPosition(state.nodes, startX, startY, width, height, getNodeSize);
  }

  function centerFromMinimapEvent(event: MouseEvent) {
    state.canvas = centerCanvasFromMinimapPointer({
      event,
      minimap: dom.minimap,
      minimapBounds: state.minimapBounds,
      canvas: state.canvas,
    });
    updateTransform();
  }

  return {
    updateTransform,
    drawEdges,
    updateMinimap,
    zoom,
    zoomFit,
    center,
    focusNode,
    screenToCanvas,
    getNodeSize,
    getNodeRect,
    getGraphBounds,
    getVisibleBounds,
    findSmartChildPosition,
    findSafePosition,
    centerFromMinimapEvent,
  };
}
