import { applyAnnotationToContainer } from '../annotations.js';
import { renderStreamdownMarkdown, unmountStreamdownMarkdown } from '../streamdown-renderer.js';
import { createTiledLayoutController } from './layout.js';
import { createTiledNavigationController } from './navigation.js';
import { createTiledRelationsController } from './relations.js';
import { createTiledRenderController } from './render.js';
import { createTiledTailScrollController } from './tail-scroll.js';
import { clamp, cssAttr } from '../utils.js';
import {
  DEFAULT_TILED_COLUMN_WIDTH,
  DEFAULT_TILED_LANE_GAP,
  DEFAULT_TILED_SECTION_HEIGHT,
  MAX_TILED_COLUMN_WIDTH,
  MAX_TILED_SECTION_HEIGHT,
  MIN_TILED_COLUMN_WIDTH,
  MIN_TILED_SECTION_HEIGHT,
  createDefaultTiledWorkspace,
  projectTiledColumns,
} from '../../shared/workspace.js';

type TiledWorkspaceControllerOptions = {
  root: HTMLElement;
  state: any;
  getNode: (id: string) => any;
  openFullscreen: (id: string) => void;
  isEditableTarget: (target: EventTarget | null) => boolean;
};

export function createTiledWorkspaceController(options: TiledWorkspaceControllerOptions) {
  const { root, state, getNode, openFullscreen, isEditableTarget } = options;
  let resizeGesture: any = null;
  let panGesture: any = null;
  let suppressNextClick = false;
  let pendingResizeLayoutRefresh = 0;
  let pendingContentScrollLayoutRefresh = 0;
  let pendingAnchorMaterializedRefresh = 0;
  const layoutEngine = createTiledLayoutController({ root, state, getNode });
  const relations = createTiledRelationsController({ root, state, ensureWorkspace });
  const tailScroll = createTiledTailScrollController({ ensurePageState });
  const tiledRender = createTiledRenderController({
    root,
    state,
    getNode,
    attachScrollIntent: tailScroll.attachScrollIntent,
    onContentAnchorsChanged: handleContentAnchorsChanged,
  });
  const navigation = createTiledNavigationController({
    root,
    state,
    getNode,
    ensureWorkspace,
    refreshLayoutPositions,
    runFocusedAction,
    isEditableTarget,
  });

  function ensureWorkspace() {
    let workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId) || state.workspaces[0];
    if (!workspace) {
      workspace = createDefaultTiledWorkspace(state.nodes, state.edges, undefined, state.annotations || []);
      state.workspaces = [workspace];
      state.activeWorkspaceId = workspace.id;
    }
    return workspace;
  }

  function render() {
    const previousScrollLeft = root.scrollLeft;
    const previousScrollTop = root.scrollTop;
    const previousFieldOffsetY = layoutEngine.getCurrentFieldOffsetY();
    unmountStreamdownContent();

    if (state.nodes.length === 0) {
      root.innerHTML = '<div class="tiled-empty">还没有文档节点。创建或加载流程图后即可使用平铺视图。</div>';
      return;
    }

    const workspace = ensureWorkspace();
    const projection = projectTiledColumns(state.nodes, state.edges, workspace, state.annotations || []);
    workspace.columns = projection.columns;

    if (projection.columns.length === 0) {
      root.innerHTML = '<div class="tiled-empty">当前 workspace 没有可显示的节点。</div>';
      return;
    }

    const layouts = layoutEngine.getContextualLayouts(projection, workspace);
    const fieldGeometry = layoutEngine.getFieldGeometry(projection.columns, layouts);
    const { fieldOffsetY, fieldWidth, fieldHeight } = fieldGeometry;

    root.innerHTML = '';
    const fieldEl = tiledRender.createField(fieldWidth, fieldHeight, fieldOffsetY);
    root.appendChild(fieldEl);

    let laneX = 0;
    for (const column of projection.columns) {
      fieldEl.appendChild(tiledRender.renderColumn(column, laneX, fieldHeight));
      laneX += column.width + DEFAULT_TILED_LANE_GAP;
    }

    for (const layout of layouts) {
      const node = getNode(layout.nodeId);
      if (!node) continue;
      fieldEl.appendChild(tiledRender.renderSection(node, workspace.pages[node.id], workspace, layout, fieldOffsetY));
    }

    root.scrollLeft = previousScrollLeft;
    root.scrollTop = previousScrollTop + fieldOffsetY - previousFieldOffsetY;
    relations.scheduleDraw();
  }

  function refreshLayoutPositions(options: { animateRelations?: boolean; animateSections?: boolean; animateFocusedSection?: boolean; lockFocusedViewport?: boolean } = {}) {
    const workspace = ensureWorkspace();
    const fieldEl = root.querySelector('.tiled-field') as HTMLElement | null;
    if (!fieldEl || state.nodes.length === 0) return;
    const immediateSectionLayout = options.animateSections === false;
    const stableFocusedSection = options.animateFocusedSection === false;
    if (immediateSectionLayout || stableFocusedSection) {
      root.classList.toggle('tiled-layout-immediate', immediateSectionLayout);
      root.classList.toggle('tiled-layout-stable-focus', stableFocusedSection);
      void root.offsetHeight;
    }
    const lockedFocusedNodeId = options.lockFocusedViewport ? workspace.focus?.nodeId || '' : '';
    const lockedFocusedViewportTop = lockedFocusedNodeId ? getSectionViewportTop(lockedFocusedNodeId) : NaN;
    const previousScrollLeft = root.scrollLeft;
    const previousScrollTop = root.scrollTop;
    const previousFieldOffsetY = layoutEngine.getCurrentFieldOffsetY();
    const projection = projectTiledColumns(state.nodes, state.edges, workspace, state.annotations || []);
    workspace.columns = projection.columns;
    const layouts = layoutEngine.getContextualLayouts(projection, workspace);
    const { fieldOffsetY, fieldWidth, fieldHeight } = layoutEngine.getFieldGeometry(projection.columns, layouts);
    const fieldOffsetDelta = fieldOffsetY - previousFieldOffsetY;
    const stageFieldOffset = !immediateSectionLayout && Math.abs(fieldOffsetDelta) > 0.5;
    if (stageFieldOffset) {
      root.classList.add('tiled-layout-immediate');
      fieldEl.querySelectorAll<HTMLElement>('.tiled-section').forEach((section) => {
        section.style.top = `${(Number.parseFloat(section.style.top) || 0) + fieldOffsetDelta}px`;
      });
      root.scrollTop = previousScrollTop + fieldOffsetDelta;
      void root.offsetHeight;
      if (!immediateSectionLayout) root.classList.remove('tiled-layout-immediate');
    }

    fieldEl.style.width = `${fieldWidth}px`;
    fieldEl.style.height = `${fieldHeight}px`;
    fieldEl.dataset.stackOffsetY = String(fieldOffsetY);

    let laneX = 0;
    for (const column of projection.columns) {
      const columnEl = fieldEl.querySelector(`[data-column-id="${cssAttr(column.id)}"]`) as HTMLElement | null;
      if (columnEl) {
        columnEl.style.left = `${laneX}px`;
        columnEl.style.width = `${column.width}px`;
        columnEl.style.height = `${fieldHeight}px`;
      }
      laneX += column.width + DEFAULT_TILED_LANE_GAP;
    }

    for (const layout of layouts) {
      const section = fieldEl.querySelector(`[data-node-id="${cssAttr(layout.nodeId)}"]`) as HTMLElement | null;
      if (!section) continue;
      section.classList.toggle('focused', workspace.focus?.nodeId === layout.nodeId);
      section.dataset.stackY = String(layout.y);
      section.style.left = `${layout.x}px`;
      section.style.top = `${fieldOffsetY + layout.y}px`;
      section.style.width = `${layout.width}px`;
      section.style.height = `${layout.height}px`;
    }

    root.scrollLeft = previousScrollLeft;
    root.scrollTop = previousScrollTop + fieldOffsetY - previousFieldOffsetY;
    if (lockedFocusedNodeId && Number.isFinite(lockedFocusedViewportTop)) {
      const currentFocusedViewportTop = getSectionViewportTop(lockedFocusedNodeId);
      if (Number.isFinite(currentFocusedViewportTop)) root.scrollTop += currentFocusedViewportTop - lockedFocusedViewportTop;
    }
    requestAnimationFrame(() => {
      if (options.animateRelations === false) relations.scheduleDraw();
      else relations.animate();
      if (immediateSectionLayout) root.classList.remove('tiled-layout-immediate');
      if (stableFocusedSection) root.classList.remove('tiled-layout-stable-focus');
    });
  }

  function getSectionViewportTop(nodeId: string) {
    const section = root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`) as HTMLElement | null;
    if (!section) return NaN;
    return section.getBoundingClientRect().top - root.getBoundingClientRect().top;
  }

  function unmountStreamdownContent(nodeId = '') {
    const selector = nodeId
      ? `[data-node-id="${cssAttr(nodeId)}"] .tiled-markdown-host`
      : '.tiled-markdown-host';
    root.querySelectorAll(selector).forEach((contentEl) => {
      unmountStreamdownMarkdown(contentEl as HTMLElement);
    });
    if (nodeId) tailScroll.disconnect(nodeId);
    else tailScroll.disconnectAll();
  }

  async function renderStreamdownContent(nodeId, markdown, options: any = {}) {
    if (state.activeView !== 'tiled') return false;
    const contentEl = root.querySelector(`[data-node-id="${cssAttr(nodeId)}"] .tiled-content`) as HTMLElement | null;
    const hostEl = contentEl?.querySelector('.tiled-markdown-host') as HTMLElement | null;
    if (!contentEl || !hostEl) {
      tiledRender.updateNodeShell(nodeId);
      return false;
    }
    const pageState = ensurePageState(nodeId);
    const scrollState = tailScroll.captureContentScrollState(contentEl, nodeId);
    const renderVersion = String((Number(hostEl.dataset.renderVersion) || 0) + 1);
    hostEl.dataset.renderVersion = renderVersion;
    await renderStreamdownMarkdown(hostEl, markdown || '', { streaming: options.streaming !== false });
    if (!hostEl.isConnected || hostEl.dataset.renderVersion !== renderVersion) return true;
    const nodeAnnotations = (state.annotations || []).filter((annotation) => annotation.sourceNodeId === nodeId);
    nodeAnnotations.forEach((annotation) => applyAnnotationToContainer(hostEl, annotation));
    tailScroll.restoreContentScroll(contentEl, pageState, scrollState);
    tailScroll.attachScrollIntent(nodeId, contentEl);
    tiledRender.updateNodeShell(nodeId);
    if (nodeAnnotations.length > 0) handleContentAnchorsChanged(nodeId);
    else relations.scheduleDraw();
    return true;
  }

  function handlePointerDown(event) {
    if (event.button === 1) return startPanGesture(event);
    if (!event.shiftKey || event.button !== 0 || isEditableTarget(event.target)) return false;
    const section = (event.target as Element).closest('.tiled-section') as HTMLElement | null;
    if (!section) return false;
    const nodeId = section.dataset.nodeId;
    if (!nodeId) return false;
    const workspace = ensureWorkspace();
    const column = workspace.columns.find((item) => item.pageIds.includes(nodeId));
    const pageState = ensurePageState(nodeId);
    if (!column) return false;

    resizeGesture = {
      pointerId: event.pointerId,
      nodeId,
      columnId: column.id,
      startX: event.clientX,
      startY: event.clientY,
      startColumnWidth: Number(column.width) || DEFAULT_TILED_COLUMN_WIDTH,
      startPanelHeight: Number(pageState.height) || DEFAULT_TILED_SECTION_HEIGHT,
      moved: false,
    };
    root.classList.add('tiled-resizing');
    section.classList.add('resizing');
    focusSection(section);
    root.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return true;
  }

  function startPanGesture(event) {
    panGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: root.scrollLeft,
      startScrollTop: root.scrollTop,
      moved: false,
    };
    root.classList.add('tiled-panning');
    root.setPointerCapture?.(event.pointerId);
    hideNativeSelection();
    event.preventDefault();
    return true;
  }

  function handlePointerMove(event) {
    if (panGesture && event.pointerId === panGesture.pointerId) return updatePanGesture(event);
    if (!resizeGesture || event.pointerId !== resizeGesture.pointerId) return false;
    const dx = event.clientX - resizeGesture.startX;
    const dy = event.clientY - resizeGesture.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) resizeGesture.moved = true;
    const workspace = ensureWorkspace();
    const column = workspace.columns.find((item) => item.id === resizeGesture.columnId);
    const pageState = ensurePageState(resizeGesture.nodeId);
    if (!column) return true;
    column.width = clamp(resizeGesture.startColumnWidth + dx, MIN_TILED_COLUMN_WIDTH, MAX_TILED_COLUMN_WIDTH);
    pageState.height = clamp(resizeGesture.startPanelHeight + dy, MIN_TILED_SECTION_HEIGHT, MAX_TILED_SECTION_HEIGHT);
    workspace.updatedAt = new Date().toISOString();
    scheduleResizeLayoutRefresh();
    event.preventDefault();
    return true;
  }

  function updatePanGesture(event) {
    const dx = event.clientX - panGesture.startX;
    const dy = event.clientY - panGesture.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) panGesture.moved = true;
    root.scrollLeft = panGesture.startScrollLeft - dx;
    root.scrollTop = panGesture.startScrollTop - dy;
    relations.scheduleDraw();
    event.preventDefault();
    return true;
  }

  function finishPointerGesture(event) {
    if (panGesture && event.pointerId === panGesture.pointerId) return finishPanGesture(event);
    if (!resizeGesture || event.pointerId !== resizeGesture.pointerId) return false;
    suppressNextClick = Boolean(resizeGesture.moved);
    root.releasePointerCapture?.(event.pointerId);
    flushResizeLayoutRefresh();
    root.classList.remove('tiled-resizing');
    root.querySelector(`[data-node-id="${cssAttr(resizeGesture.nodeId)}"]`)?.classList.remove('resizing');
    resizeGesture = null;
    event.preventDefault();
    return true;
  }

  function finishPanGesture(event) {
    suppressNextClick = Boolean(panGesture.moved);
    root.releasePointerCapture?.(event.pointerId);
    root.classList.remove('tiled-panning');
    panGesture = null;
    event.preventDefault();
    return true;
  }

  function handleAuxClick(event) {
    if (event.button !== 1) return false;
    event.preventDefault();
    return true;
  }

  function scheduleResizeLayoutRefresh() {
    if (pendingResizeLayoutRefresh) return;
    pendingResizeLayoutRefresh = requestAnimationFrame(() => {
      pendingResizeLayoutRefresh = 0;
      if (state.activeView === 'tiled') refreshLayoutPositions({ animateRelations: false, animateSections: false });
    });
  }

  function flushResizeLayoutRefresh() {
    if (pendingResizeLayoutRefresh) {
      cancelAnimationFrame(pendingResizeLayoutRefresh);
      pendingResizeLayoutRefresh = 0;
    }
    if (state.activeView === 'tiled') refreshLayoutPositions({ animateRelations: false, animateSections: false });
  }

  function scheduleContentScrollLayoutRefresh() {
    if (pendingContentScrollLayoutRefresh) return;
    pendingContentScrollLayoutRefresh = requestAnimationFrame(() => {
      pendingContentScrollLayoutRefresh = 0;
      if (state.activeView === 'tiled') refreshLayoutPositions({ animateRelations: false, animateSections: false, lockFocusedViewport: true });
    });
  }

  function handleContentAnchorsChanged(nodeId: string) {
    if (state.activeView !== 'tiled') return;
    if (isFocusRelatedAnnotationNode(nodeId)) scheduleAnchorMaterializedRefresh();
    else relations.scheduleDraw();
  }

  function isFocusRelatedAnnotationNode(nodeId: string) {
    const focusedId = ensureWorkspace().focus?.nodeId || '';
    if (!focusedId) return false;
    if (nodeId === focusedId) return true;
    return (state.annotations || []).some((annotation) => annotation.sourceNodeId === nodeId && annotation.targetNodeId === focusedId);
  }

  function scheduleAnchorMaterializedRefresh() {
    if (pendingAnchorMaterializedRefresh) return;
    pendingAnchorMaterializedRefresh = requestAnimationFrame(() => {
      pendingAnchorMaterializedRefresh = 0;
      if (state.activeView === 'tiled') refreshLayoutPositions({ animateRelations: false, animateSections: false, lockFocusedViewport: true });
    });
  }

  function hideNativeSelection() {
    window.getSelection()?.removeAllRanges();
  }

  function handleClick(event) {
    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault();
      return;
    }
    const actionButton = (event.target as Element).closest('[data-tiled-action]') as HTMLElement | null;
    if (actionButton) {
      event.preventDefault();
      runAction(actionButton);
      return;
    }

    const annotated = (event.target as Element).closest('mark.annotated, .math-node.annotated-math, .katex.annotated-math') as HTMLElement | null;
    const targetId = annotated?.dataset.refId;
    if (targetId) {
      event.preventDefault();
      focusWorkspaceNode(targetId, { scroll: true });
      return;
    }

    focusSection((event.target as Element).closest('.tiled-section') as HTMLElement | null);

    const header = (event.target as Element).closest('.tiled-section-header') as HTMLElement | null;
    const section = header?.closest('.tiled-section') as HTMLElement | null;
    const nodeId = section?.dataset.nodeId;
    if (nodeId) openFullscreen(nodeId);
  }

  function runFocusedAction(action) {
    const workspace = ensureWorkspace();
    const nodeId = workspace.focus?.nodeId || workspace.columns[0]?.pageIds[0];
    if (!nodeId) return;
    const pageState = ensurePageState(nodeId);
    if (action === 'section-title-toggle') {
      pageState.display = pageState.display === 'title' ? 'normal' : 'title';
    } else if (action === 'section-shorter' || action === 'section-taller') {
      const delta = action === 'section-taller' ? 60 : -60;
      pageState.height = clamp(Number(pageState.height) + delta, MIN_TILED_SECTION_HEIGHT, MAX_TILED_SECTION_HEIGHT);
    }
    workspace.focus = { workspaceId: workspace.id, region: 'columns', nodeId };
    workspace.updatedAt = new Date().toISOString();
    if (action === 'section-title-toggle') render();
    else refreshLayoutPositions();
  }

  function focusSection(section) {
    const nodeId = section?.dataset.nodeId;
    if (!nodeId) return;
    const changed = ensureWorkspace().focus?.nodeId !== nodeId;
    focusWorkspaceNode(nodeId, { scroll: false, forceRefresh: changed });
    if (!changed) {
      root.querySelectorAll('.tiled-section.focused').forEach((item) => item.classList.remove('focused'));
      section.classList.add('focused');
      relations.scheduleDraw();
    }
  }

  function focusWorkspaceNode(nodeId, { scroll = false, forceRefresh = true } = {}) {
    if (!getNode(nodeId)) return false;
    const workspace = ensureWorkspace();
    const projection = projectTiledColumns(state.nodes, state.edges, workspace, state.annotations || []);
    workspace.columns = projection.columns;
    const column = projection.columns.find((item) => item.pageIds.includes(nodeId));
    workspace.focus = { workspaceId: workspace.id, region: 'columns', columnId: column?.id, nodeId };
    workspace.updatedAt = new Date().toISOString();

    const existingSection = root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`);
    if (existingSection && forceRefresh) refreshLayoutPositions({ animateFocusedSection: false, lockFocusedViewport: true });
    else if (!existingSection) render();

    if (scroll) {
      requestAnimationFrame(() => {
        root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    }
    return true;
  }

  function handleScroll(event) {
    if (event.target === root) {
      relations.scheduleDraw();
      return;
    }
    const content = (event.target as Element).closest?.('.tiled-content') as HTMLElement | null;
    const nodeId = content?.closest('.tiled-section')?.getAttribute('data-node-id');
    if (!content || !nodeId) return;
    tailScroll.updateTailState(nodeId, content);
    const pageState = ensurePageState(nodeId);
    pageState.scrollTop = content.scrollTop;
    if (ensureWorkspace().focus?.nodeId === nodeId) scheduleContentScrollLayoutRefresh();
    else relations.scheduleDraw();
  }

  function runAction(button) {
    const action = button.dataset.tiledAction;
    const workspace = ensureWorkspace();
    const columnEl = button.closest('.tiled-column') as HTMLElement | null;
    const sectionEl = button.closest('.tiled-section') as HTMLElement | null;

    if ((action === 'column-narrow' || action === 'column-widen') && columnEl) {
      const columnId = columnEl.dataset.columnId;
      const column = workspace.columns.find((item) => item.id === columnId);
      if (!column) return;
      const delta = action === 'column-widen' ? 60 : -60;
      column.width = clamp(Number(column.width) + delta, MIN_TILED_COLUMN_WIDTH, MAX_TILED_COLUMN_WIDTH);
      workspace.updatedAt = new Date().toISOString();
      refreshLayoutPositions();
      return;
    }

    const nodeId = sectionEl?.dataset.nodeId;
    if (!nodeId) return;
    const column = workspace.columns.find((item) => item.pageIds.includes(nodeId));
    workspace.focus = { workspaceId: workspace.id, region: 'columns', columnId: column?.id, nodeId };
    const pageState = ensurePageState(nodeId);
    if (action === 'section-shorter' || action === 'section-taller') {
      const delta = action === 'section-taller' ? 60 : -60;
      pageState.height = clamp(Number(pageState.height) + delta, MIN_TILED_SECTION_HEIGHT, MAX_TILED_SECTION_HEIGHT);
    } else if (action === 'section-title-toggle') {
      pageState.display = pageState.display === 'title' ? 'normal' : 'title';
    }
    workspace.updatedAt = new Date().toISOString();
    if (action === 'section-title-toggle') render();
    else refreshLayoutPositions();
  }

  function isTitleOnly(nodeId) {
    return ensureWorkspace().pages?.[nodeId]?.display === 'title';
  }

  function toggleTitleOnly(nodeIds) {
    const ids = Array.from(new Set(nodeIds || [])).filter((id: any) => getNode(String(id)));
    if (ids.length === 0) return;
    const workspace = ensureWorkspace();
    const shouldShowTitleOnly = ids.some((id) => ensurePageState(String(id)).display !== 'title');
    for (const id of ids) {
      ensurePageState(String(id)).display = shouldShowTitleOnly ? 'title' : 'normal';
    }
    workspace.updatedAt = new Date().toISOString();
    render();
  }

  function ensurePageState(nodeId) {
    const workspace = ensureWorkspace();
    const existing = workspace.pages[nodeId];
    if (existing) return existing;
    workspace.pages[nodeId] = {
      nodeId,
      display: 'normal',
      height: DEFAULT_TILED_SECTION_HEIGHT,
      scrollTop: 0,
    };
    return workspace.pages[nodeId];
  }

  return {
    ensureWorkspace,
    render,
    handleClick,
    handleKeydown: navigation.handleKeydown,
    handleScroll,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: finishPointerGesture,
    handlePointerCancel: finishPointerGesture,
    handleAuxClick,
    renderStreamdownContent,
    updateNodeShell: tiledRender.updateNodeShell,
    focusNode: focusWorkspaceNode,
    isTitleOnly,
    toggleTitleOnly,
  };
}
