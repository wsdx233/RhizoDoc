import { clamp } from '../utils.js';
import { MARQUEE_DRAG_THRESHOLD, NODE_MAX_WIDTH, NODE_MIN_WIDTH, NODE_WIDTH } from './constants.js';
import { rectsIntersect } from './geometry.js';

export function isEditableTarget(target: any) {
  return Boolean(target?.closest?.('input, textarea, select, button, [contenteditable="true"], [contenteditable=""]'));
}

export function createCanvasInteractionsController(options: {
  dom: any;
  state: any;
  getNode: (id: string) => any;
  canvasWorkspace: any;
  canvasNodes: any;
  getSelectedNodeIds: () => string[];
  setNodeSelection: (ids: string[]) => void;
  clearNodeSelection: () => void;
  toggleNodeSelection: (id: string) => void;
  getActionNodeIds: (clickedId: string) => string[];
  hideTooltip: () => void;
  hideMenus: () => void;
  openFullscreen: (id: string) => void;
}) {
  const {
    dom,
    state,
    getNode,
    canvasWorkspace,
    canvasNodes,
    getSelectedNodeIds,
    setNodeSelection,
    clearNodeSelection,
    toggleNodeSelection,
    getActionNodeIds,
    hideTooltip,
    hideMenus,
    openFullscreen,
  } = options;

  function handleViewportMouseDown(event: MouseEvent) {
    syncModifierModesFromPointerEvent(event);
    const isLeftButton = event.button === 0;
    const isMiddleButton = event.button === 1;
    if (!isLeftButton && !isMiddleButton) return;

    if (isLeftButton && state.isMultiSelectMode && !(event.target as Element).closest('#action-tooltip, #toolbar, #topbar, .context-menu')) {
      startMarqueeSelection(event);
      return;
    }

    // 左键保持原逻辑：点在节点/浮层/工具栏时不拖动画布。
    // 中键作为全局画布平移入口：即使鼠标在文档节点内容中，也可以直接拖动画布。
    if (isLeftButton && (event.target as Element).closest('.node, #action-tooltip, #toolbar, #topbar')) return;

    state.isDragging = true;
    state.dragStart = { x: event.clientX - state.canvas.x, y: event.clientY - state.canvas.y };
    hideTooltip();
    hideMenus();

    if (isMiddleButton) event.preventDefault();
  }

  function handleViewportAuxClick(event: MouseEvent) {
    if (event.button === 1) event.preventDefault();
  }

  function handleNodesLayerMouseDown(event: MouseEvent) {
    syncModifierModesFromPointerEvent(event);
    if (event.button !== 0) return;
    const nodeEl = (event.target as Element).closest('.node') as HTMLElement | null;
    if (!nodeEl) return;

    if (state.isMultiSelectMode) {
      startMarqueeSelection(event, nodeEl.id);
      event.stopPropagation();
      return;
    }

    if (state.isMoveMode) {
      startNodeDrag(event, nodeEl);
      return;
    }

    const resizeHandle = (event.target as Element).closest('.resize-handle') as HTMLElement | null;
    if (resizeHandle) {
      const node = getNode(nodeEl.id);
      if (!node) return;
      state.isResizing = true;
      state.resizeNodeId = nodeEl.id;
      state.resizeStartWidth = nodeEl.offsetWidth || node.width || NODE_WIDTH;
      state.resizeStartNodeX = node.x;
      state.resizeStartX = event.clientX;
      state.resizeHandleSide = nodeEl.dataset.dir === 'left' ? 'left' : 'right';
      hideTooltip();
      hideMenus();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if ((event.target as Element).closest('.node-btn') || (event.target as Element).closest('.expand-btn')) return;

    if (state.isNodeDragMode) {
      startNodeDrag(event, nodeEl);
      return;
    }

    const header = (event.target as Element).closest('.node-header');
    if (!header) return;
    startNodeDrag(event, nodeEl);
  }

  function handleNodesLayerClick(event: MouseEvent) {
    if (state.suppressNodeClick) {
      event.preventDefault();
      event.stopPropagation();
      state.suppressNodeClick = false;
      return;
    }

    const action = (event.target as Element).closest('[data-node-action]') as HTMLElement | null;
    if (action && !action.classList.contains('resize-handle')) {
      const nodeEl = action.closest('.node') as HTMLElement | null;
      if (!nodeEl) return;
      event.preventDefault();
      event.stopPropagation();
      hideTooltip();
      hideMenus();
      const actionName = action.dataset.nodeAction;
      if (actionName === 'fullscreen') openFullscreen(nodeEl.id);
      if (actionName === 'toggle') canvasNodes.toggleManyCollapse(getActionNodeIds(nodeEl.id), !nodeEl.classList.contains('collapsed'));
      return;
    }

    const annotated = (event.target as Element).closest('mark.annotated, .math-node.annotated-math, .katex.annotated-math') as HTMLElement | null;
    if (!annotated) return;
    const targetId = annotated.dataset.refId;
    if (targetId) canvasWorkspace.focusNode(targetId);
  }

  function startNodeDrag(event: MouseEvent, nodeEl: HTMLElement) {
    const node = getNode(nodeEl.id);
    if (!node) return;

    const selectedIds = getSelectedNodeIds();
    const shouldDragSelection = selectedIds.length > 0 && selectedIds.includes(nodeEl.id);
    if (!shouldDragSelection && selectedIds.length > 0) clearNodeSelection();
    const dragIds = shouldDragSelection ? selectedIds : [nodeEl.id];
    state.isDraggingNode = true;
    state.draggedNodeId = nodeEl.id;
    state.nodeDragIds = dragIds;
    state.nodeDragStartPoint = canvasWorkspace.screenToCanvas(event.clientX, event.clientY);
    state.nodeDragStartClient = { x: event.clientX, y: event.clientY };
    state.nodeDragStartPositions = dragIds
      .map((id) => getNode(id))
      .filter(Boolean)
      .map((item) => ({ id: item.id, x: item.x, y: item.y }));
    for (const id of dragIds) document.getElementById(id)?.classList.add('dragging');
    const rect = nodeEl.getBoundingClientRect();
    state.nodeDragOffset = {
      x: (event.clientX - rect.left) / state.canvas.scale,
      y: (event.clientY - rect.top) / state.canvas.scale,
    };
    state.nodeDragMoved = false;
    state.nodeDragStartedInMoveMode = state.isMoveMode;
    hideTooltip();
    hideMenus();
    window.getSelection()?.removeAllRanges();
    event.preventDefault();
    event.stopPropagation();
  }

  function handleWindowMouseMove(event: MouseEvent) {
    if (state.isDraggingMinimap) {
      canvasWorkspace.centerFromMinimapEvent(event);
      return;
    }

    if (state.isMarqueeSelecting) {
      updateMarqueeSelection(event);
      return;
    }

    if (state.isDragging) {
      state.canvas.x = event.clientX - state.dragStart.x;
      state.canvas.y = event.clientY - state.dragStart.y;
      canvasWorkspace.updateTransform();
      return;
    }

    if (state.isResizing && state.resizeNodeId) {
      const node = getNode(state.resizeNodeId);
      const nodeEl = document.getElementById(state.resizeNodeId);
      if (!node || !nodeEl) return;
      const delta = (event.clientX - state.resizeStartX) / state.canvas.scale;
      const resizingFromLeft = state.resizeHandleSide === 'left';
      const newWidth = clamp(
        state.resizeStartWidth + (resizingFromLeft ? -delta : delta),
        NODE_MIN_WIDTH,
        NODE_MAX_WIDTH,
      );
      node.width = newWidth;
      if (resizingFromLeft) {
        node.x = state.resizeStartNodeX + state.resizeStartWidth - newWidth;
        nodeEl.style.left = `${node.x}px`;
      }
      node.updatedAt = new Date().toISOString();
      nodeEl.style.width = `${newWidth}px`;
      canvasNodes.updateCollapseState(node.id);
      canvasWorkspace.drawEdges();
      canvasWorkspace.updateMinimap();
      return;
    }

    if (state.isDraggingNode && state.draggedNodeId) {
      const current = canvasWorkspace.screenToCanvas(event.clientX, event.clientY);
      const dx = current.x - state.nodeDragStartPoint.x;
      const dy = current.y - state.nodeDragStartPoint.y;
      const clientDistance = Math.hypot(event.clientX - state.nodeDragStartClient.x, event.clientY - state.nodeDragStartClient.y);
      if (clientDistance > MARQUEE_DRAG_THRESHOLD) state.nodeDragMoved = true;

      for (const start of state.nodeDragStartPositions) {
        const node = getNode(start.id);
        const nodeEl = document.getElementById(start.id);
        if (!node || !nodeEl) continue;
        const newX = start.x + dx;
        const newY = start.y + dy;
        node.x = newX;
        node.y = newY;
        node.updatedAt = new Date().toISOString();
        nodeEl.style.left = `${newX}px`;
        nodeEl.style.top = `${newY}px`;
      }
      canvasWorkspace.drawEdges();
      canvasWorkspace.updateMinimap();
    }
  }

  function handleWindowMouseUp() {
    if (state.isMarqueeSelecting) finishMarqueeSelection({ cancel: false });
    state.isDragging = false;
    if (state.isDraggingNode && (state.nodeDragMoved || state.nodeDragStartedInMoveMode)) suppressNextNodeClick();
    document.querySelectorAll('.node.dragging').forEach((nodeEl) => nodeEl.classList.remove('dragging'));
    state.isDraggingNode = false;
    state.draggedNodeId = null;
    state.nodeDragIds = [];
    state.nodeDragStartPositions = [];
    state.nodeDragMoved = false;
    state.nodeDragStartedInMoveMode = false;
    state.isResizing = false;
    state.resizeNodeId = null;
    state.resizeHandleSide = 'right';
    state.isDraggingMinimap = false;
    dom.minimap.classList.remove('dragging');
  }

  function handleViewportWheel(event: WheelEvent) {
    if (shouldPreserveNativeWheel(event)) return;
    event.preventDefault();
    canvasWorkspace.zoom(-event.deltaY * 0.001, event.clientX, event.clientY);
    hideTooltip();
  }

  function shouldPreserveNativeWheel(event: WheelEvent) {
    const target = event.target as Element;
    if (target.closest('#toolbar, #topbar, #action-tooltip, .context-menu')) return true;

    const codeBlock = target.closest('.node-content pre, .fs-content pre');
    return Boolean(codeBlock && isScrollableElement(codeBlock));
  }

  function isScrollableElement(element: Element) {
    return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
  }

  function updateInteractionModes(event: KeyboardEvent) {
    const editable = isEditableTarget(event.target);
    if (editable) {
      if (event.type === 'keyup') {
        if (event.code === 'Space' || event.key === ' ') state.isMoveMode = false;
        if (event.key === 'Control' || event.key === 'Meta' || (!event.ctrlKey && !event.metaKey)) state.isMultiSelectMode = false;
        if (event.key === 'Shift' || !event.shiftKey) state.isNodeDragMode = Boolean(event.shiftKey);
        syncInteractionModeClasses();
      }
      return;
    }

    if (event.type === 'keydown') {
      if (event.code === 'Space' || event.key === ' ') {
        state.isMoveMode = true;
        event.preventDefault();
      }
      state.isMultiSelectMode = Boolean(event.ctrlKey || event.metaKey || event.key === 'Control' || event.key === 'Meta');
      state.isNodeDragMode = Boolean(event.shiftKey || event.key === 'Shift');
    } else if (event.type === 'keyup') {
      if (event.code === 'Space' || event.key === ' ') state.isMoveMode = false;
      state.isMultiSelectMode = Boolean(event.ctrlKey || event.metaKey);
      state.isNodeDragMode = Boolean(event.shiftKey);
    }
    syncInteractionModeClasses();
  }

  function syncModifierModesFromPointerEvent(event: MouseEvent) {
    if (isEditableTarget(event.target)) return;
    state.isMultiSelectMode = Boolean(event.ctrlKey || event.metaKey);
    state.isNodeDragMode = Boolean(event.shiftKey);
    syncInteractionModeClasses();
  }

  function syncInteractionModeClasses() {
    document.body.classList.toggle('move-mode', state.isMoveMode);
    document.body.classList.toggle('multi-select-mode', state.isMultiSelectMode);
    dom.viewport.classList.toggle('move-mode', state.isMoveMode);
    dom.viewport.classList.toggle('multi-select-mode', state.isMultiSelectMode);
    document.body.classList.toggle('node-drag-mode', state.isNodeDragMode);
    dom.viewport.classList.toggle('node-drag-mode', state.isNodeDragMode);
  }

  function resetModifierModes() {
    state.isMoveMode = false;
    state.isMultiSelectMode = false;
    state.isNodeDragMode = false;
    syncInteractionModeClasses();
  }

  function startMarqueeSelection(event: MouseEvent, startNodeId = null) {
    state.isMarqueeSelecting = true;
    state.marqueeStart = { x: event.clientX, y: event.clientY };
    state.marqueeMoved = false;
    state.marqueeStartNodeId = startNodeId;
    state.marqueeBaseSelectionIds = getSelectedNodeIds();
    dom.selectionBox.style.display = 'none';
    hideTooltip();
    hideMenus();
    window.getSelection()?.removeAllRanges();
    event.preventDefault();
    event.stopPropagation();
  }

  function updateMarqueeSelection(event: MouseEvent) {
    const distance = Math.hypot(event.clientX - state.marqueeStart.x, event.clientY - state.marqueeStart.y);
    if (distance > MARQUEE_DRAG_THRESHOLD) state.marqueeMoved = true;
    if (!state.marqueeMoved) return;

    updateSelectionBox(event.clientX, event.clientY);
    const marqueeRect = getMarqueeCanvasRect(event.clientX, event.clientY);
    const hitIds = state.nodes
      .filter((node) => rectsIntersect(marqueeRect, canvasWorkspace.getNodeRect(node)))
      .map((node) => node.id);
    setNodeSelection(hitIds);
    event.preventDefault();
  }

  function finishMarqueeSelection({ cancel = false } = {}) {
    const wasMoved = state.marqueeMoved;
    const startNodeId = state.marqueeStartNodeId;
    const baseSelectionIds = state.marqueeBaseSelectionIds;
    dom.selectionBox.style.display = 'none';
    state.isMarqueeSelecting = false;
    state.marqueeMoved = false;
    state.marqueeStartNodeId = null;
    state.marqueeBaseSelectionIds = [];

    if (cancel) {
      setNodeSelection(baseSelectionIds);
      return;
    }
    suppressNextNodeClick();
    if (wasMoved) return;
    if (startNodeId) toggleNodeSelection(startNodeId);
    else clearNodeSelection();
  }

  function updateSelectionBox(clientX: number, clientY: number) {
    const viewportRect = dom.viewport.getBoundingClientRect();
    const left = Math.min(state.marqueeStart.x, clientX) - viewportRect.left;
    const top = Math.min(state.marqueeStart.y, clientY) - viewportRect.top;
    const width = Math.abs(clientX - state.marqueeStart.x);
    const height = Math.abs(clientY - state.marqueeStart.y);
    dom.selectionBox.style.display = 'block';
    dom.selectionBox.style.left = `${left}px`;
    dom.selectionBox.style.top = `${top}px`;
    dom.selectionBox.style.width = `${width}px`;
    dom.selectionBox.style.height = `${height}px`;
  }

  function getMarqueeCanvasRect(clientX: number, clientY: number) {
    const a = canvasWorkspace.screenToCanvas(state.marqueeStart.x, state.marqueeStart.y);
    const b = canvasWorkspace.screenToCanvas(clientX, clientY);
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
  }

  function cancelMarqueeSelection() {
    if (state.isMarqueeSelecting) finishMarqueeSelection({ cancel: true });
  }

  function handleMinimapMouseDown(event: MouseEvent) {
    if (event.button !== 0 || !state.minimapBounds) return;
    state.isDraggingMinimap = true;
    dom.minimap.classList.add('dragging');
    hideTooltip();
    hideMenus();
    canvasWorkspace.centerFromMinimapEvent(event);
    event.preventDefault();
  }

  function suppressNextNodeClick() {
    state.suppressNodeClick = true;
    setTimeout(() => {
      state.suppressNodeClick = false;
    }, 120);
  }

  return {
    handleViewportMouseDown,
    handleViewportAuxClick,
    handleNodesLayerMouseDown,
    handleNodesLayerClick,
    handleWindowMouseMove,
    handleWindowMouseUp,
    handleViewportWheel,
    handleMinimapMouseDown,
    updateInteractionModes,
    resetModifierModes,
    cancelMarqueeSelection,
    syncInteractionModeClasses,
  };
}
