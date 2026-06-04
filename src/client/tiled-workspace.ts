import { applyAnnotationToContainer } from './annotations.js';
import { postProcessNodeContent, renderMarkdown } from './markdown.js';
import { renderStreamdownMarkdown, unmountStreamdownMarkdown } from './streamdown-renderer.js';
import { clamp, cssAttr } from './utils.js';
import {
  DEFAULT_TILED_LANE_GAP,
  DEFAULT_TILED_SECTION_HEIGHT,
  MAX_TILED_COLUMN_WIDTH,
  MAX_TILED_SECTION_HEIGHT,
  MIN_TILED_COLUMN_WIDTH,
  MIN_TILED_SECTION_HEIGHT,
  createDefaultTiledWorkspace,
  projectTiledColumns,
} from '../shared/workspace.js';

const TILED_FIELD_PADDING_X = 20;
const TILED_MIN_VERTICAL_SCROLL_SLACK = 360;

type TiledWorkspaceControllerOptions = {
  root: HTMLElement;
  state: any;
  getNode: (id: string) => any;
  setActiveView: (view: 'canvas' | 'tiled') => void;
  focusCanvasNode: (id: string) => void;
  openFullscreen: (id: string) => void;
  isEditableTarget: (target: EventTarget | null) => boolean;
};

export function createTiledWorkspaceController(options: TiledWorkspaceControllerOptions) {
  const { root, state, getNode, setActiveView, focusCanvasNode, openFullscreen, isEditableTarget } = options;
  const tailStateByNodeId = new Map();
  let pendingLayoutRefresh = 0;
  let isAdjustingRootScroll = false;
  let relationAnimationFrame = 0;

  function ensureWorkspace() {
    let workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId) || state.workspaces[0];
    if (!workspace) {
      workspace = createDefaultTiledWorkspace(state.nodes, state.edges);
      state.workspaces = [workspace];
      state.activeWorkspaceId = workspace.id;
    }
    return workspace;
  }

  function render() {
    const previousScrollLeft = root.scrollLeft;
    const previousScrollTop = root.scrollTop;
    const previousFieldOffsetY = getCurrentFieldOffsetY();
    unmountStreamdownContent();

    if (state.nodes.length === 0) {
      root.innerHTML = '<div class="tiled-empty">还没有文档节点。创建或加载流程图后即可使用平铺视图。</div>';
      return;
    }

    const workspace = ensureWorkspace();
    const projection = projectTiledColumns(state.nodes, state.edges, workspace);
    workspace.columns = projection.columns;

    if (projection.columns.length === 0) {
      root.innerHTML = '<div class="tiled-empty">当前 workspace 没有可显示的节点。</div>';
      return;
    }

    const layouts = getContextualLayouts(projection, workspace);
    const fieldGeometry = getFieldGeometry(projection.columns, layouts);
    const { fieldOffsetY, fieldWidth, fieldHeight } = fieldGeometry;

    root.innerHTML = '';
    const fieldEl = document.createElement('div');
    fieldEl.className = 'tiled-field';
    fieldEl.style.width = `${fieldWidth}px`;
    fieldEl.style.height = `${fieldHeight}px`;
    fieldEl.dataset.stackOffsetY = String(fieldOffsetY);
    fieldEl.innerHTML = '<svg class="tiled-relations-layer" aria-hidden="true"></svg>';
    root.appendChild(fieldEl);

    let laneX = 0;
    for (const column of projection.columns) {
      const columnEl = document.createElement('section');
      columnEl.className = 'tiled-column';
      columnEl.dataset.columnId = column.id;
      columnEl.dataset.depth = String(column.depth);
      columnEl.style.left = `${laneX}px`;
      columnEl.style.top = '0px';
      columnEl.style.width = `${column.width}px`;
      columnEl.style.height = `${fieldHeight}px`;
      columnEl.innerHTML = `
        <header class="tiled-column-header">
          <span>Depth ${column.depth}</span>
          <span class="tiled-column-actions">
            <button class="tiled-mini-btn" data-tiled-action="column-narrow" title="缩窄列">−</button>
            <button class="tiled-mini-btn" data-tiled-action="column-widen" title="加宽列">＋</button>
            <span>${column.pageIds.length} pages</span>
          </span>
        </header>
      `;
      fieldEl.appendChild(columnEl);
      laneX += column.width + DEFAULT_TILED_LANE_GAP;
    }

    for (const layout of layouts) {
      const node = getNode(layout.nodeId);
      if (!node) continue;
      fieldEl.appendChild(renderSection(node, workspace.pages[node.id], workspace, layout, fieldOffsetY));
    }

    isAdjustingRootScroll = true;
    root.scrollLeft = previousScrollLeft;
    root.scrollTop = previousScrollTop + fieldOffsetY - previousFieldOffsetY;
    requestAnimationFrame(() => {
      isAdjustingRootScroll = false;
      drawRelations();
    });
  }

  function refreshLayoutPositions() {
    const workspace = ensureWorkspace();
    const fieldEl = root.querySelector('.tiled-field') as HTMLElement | null;
    if (!fieldEl || state.nodes.length === 0) return;
    const previousScrollLeft = root.scrollLeft;
    const previousScrollTop = root.scrollTop;
    const previousFieldOffsetY = getCurrentFieldOffsetY();
    const projection = projectTiledColumns(state.nodes, state.edges, workspace);
    workspace.columns = projection.columns;
    const layouts = getContextualLayouts(projection, workspace);
    const { fieldOffsetY, fieldWidth, fieldHeight } = getFieldGeometry(projection.columns, layouts);

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

    isAdjustingRootScroll = true;
    root.scrollLeft = previousScrollLeft;
    root.scrollTop = previousScrollTop + fieldOffsetY - previousFieldOffsetY;
    requestAnimationFrame(() => {
      isAdjustingRootScroll = false;
      animateRelations();
    });
  }

  function unmountStreamdownContent(nodeId = '') {
    const selector = nodeId
      ? `[data-node-id="${cssAttr(nodeId)}"] .tiled-markdown-host`
      : '.tiled-markdown-host';
    root.querySelectorAll(selector).forEach((contentEl) => {
      unmountStreamdownMarkdown(contentEl as HTMLElement);
    });
    if (nodeId) disconnectTailState(nodeId);
    else tailStateByNodeId.forEach((_, id) => disconnectTailState(id));
  }

  function getCurrentFieldOffsetY() {
    const field = root.querySelector('.tiled-field') as HTMLElement | null;
    return Number(field?.dataset.stackOffsetY || 0) || 0;
  }

  function getViewportVerticalSlack() {
    return (root.clientHeight || 0) + TILED_MIN_VERTICAL_SCROLL_SLACK;
  }

  function getFieldGeometry(columns, layouts) {
    const slack = getViewportVerticalSlack();
    const minY = Math.min(0, ...layouts.map((layout) => layout.y));
    const maxY = Math.max(0, ...layouts.map((layout) => layout.y + layout.height));
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

  function getCandidateAnchor(candidateLayout, focusAnchor) {
    return clamp(focusAnchor, 0, candidateLayout.height);
  }

  function getContextualLayouts(projection, workspace) {
    const baseLayouts = Object.values(projection.pageLayouts) as any[];
    const focusedId = workspace.focus?.nodeId || '';
    const focusedLayout = focusedId ? projection.pageLayouts[focusedId] : null;
    if (!focusedLayout) return baseLayouts;

    const focusAnchor = getFocusVisibleAnchor(focusedLayout);
    const offsetByColumnId = new Map();
    for (const column of projection.columns) {
      if (column.pageIds.includes(focusedId)) {
        offsetByColumnId.set(column.id, 0);
        continue;
      }
      let best = null;
      for (const nodeId of column.pageIds) {
        const layout = projection.pageLayouts[nodeId];
        if (!layout) continue;
        const score = getFocusRelationScore(focusedId, nodeId);
        if (score <= 0) continue;
        if (!best || score > best.score || (score === best.score && Math.abs(layout.order - focusedLayout.order) < Math.abs(best.layout.order - focusedLayout.order))) {
          best = { layout, score };
        }
      }
      if (!best) {
        offsetByColumnId.set(column.id, 0);
        continue;
      }
      const candidateAnchor = getCandidateAnchor(best.layout, focusAnchor);
      offsetByColumnId.set(column.id, focusedLayout.y + focusAnchor - best.layout.y - candidateAnchor);
    }

    return baseLayouts.map((layout) => {
      const columnOffsetY = offsetByColumnId.get(layout.columnId) || 0;
      return { ...layout, y: layout.y + columnOffsetY, columnOffsetY };
    });
  }

  function getFocusRelationScore(focusedId, candidateId) {
    if (!focusedId || !candidateId || focusedId === candidateId) return 0;
    let score = 0;
    const focused = getNode(focusedId);
    const candidate = getNode(candidateId);
    if (!focused || !candidate) return 0;

    if (state.annotations.some((annotation) => annotation.sourceNodeId === focusedId && annotation.targetNodeId === candidateId)) score = Math.max(score, 120);
    if (state.annotations.some((annotation) => annotation.sourceNodeId === candidateId && annotation.targetNodeId === focusedId)) score = Math.max(score, 115);
    if (state.edges.some((edge) => edge.sourceId === candidateId && edge.targetId === focusedId) || focused.parentId === candidateId) score = Math.max(score, 100);
    if (state.edges.some((edge) => edge.sourceId === focusedId && edge.targetId === candidateId) || candidate.parentId === focusedId) score = Math.max(score, 95);
    if (focused.parentId && focused.parentId === candidate.parentId) score = Math.max(score, 35);
    return score;
  }

  function renderSection(node, pageState = null, workspace = null, layout = null, fieldOffsetY = 0) {
    const display = layout?.display || pageState?.display || 'normal';
    const isFocused = workspace?.focus?.nodeId === node.id;
    const section = document.createElement('article');
    section.className = `tiled-section${display === 'title' ? ' title-only' : ''}${isFocused ? ' focused' : ''}`;
    section.tabIndex = 0;
    const sectionHeight = layout?.height ?? (Number(pageState?.height) || 360);
    section.dataset.nodeId = node.id;
    section.dataset.stackY = String(layout?.y ?? 0);
    section.style.left = `${layout?.x ?? 0}px`;
    section.style.top = `${fieldOffsetY + (layout?.y ?? 0)}px`;
    section.style.width = `${layout?.width ?? 420}px`;
    section.style.height = `${sectionHeight}px`;
    setSectionColor(section, node);

    const header = document.createElement('header');
    header.className = 'tiled-section-header';
    header.innerHTML = `
      <span class="tiled-section-title"></span>
      <span class="tiled-section-actions">
        <button class="tiled-mini-btn" data-tiled-action="section-shorter" title="降低 section">−</button>
        <button class="tiled-mini-btn" data-tiled-action="section-taller" title="增高 section">＋</button>
        <button class="tiled-mini-btn" data-tiled-action="section-title-toggle" title="仅标题/展开">T</button>
        <span class="tiled-section-meta"></span>
      </span>
    `;
    header.querySelector('.tiled-section-title').textContent = node.title || '未命名节点';
    header.querySelector('.tiled-section-meta').textContent = `${(node.content || '').length} 字`;
    section.appendChild(header);

    if (display !== 'title') {
      const content = document.createElement('div');
      content.className = 'tiled-content markdown-body';
      const host = document.createElement('div');
      host.className = 'tiled-markdown-host';
      host.innerHTML = renderMarkdown(node.content || '');
      postProcessNodeContent(host);
      state.annotations
        .filter((annotation) => annotation.sourceNodeId === node.id)
        .forEach((annotation) => applyAnnotationToContainer(host, annotation));
      const sentinel = document.createElement('div');
      sentinel.className = 'tiled-bottom-sentinel';
      sentinel.setAttribute('aria-hidden', 'true');
      content.append(host, sentinel);
      content.scrollTop = Math.max(0, Number(pageState?.scrollTop) || 0);
      section.appendChild(content);
      attachScrollIntent(node.id, content);
    }

    return section;
  }

  function setSectionColor(section, node) {
    section.style.setProperty('--node-color', node.colorIndex >= 0
      ? `var(--hl-${node.colorIndex % 5}-bg)`
      : 'var(--md-sys-color-surface-container-high)');
  }

  function updateNodeShell(nodeId) {
    const node = getNode(nodeId);
    const section = root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`) as HTMLElement | null;
    if (!node || !section) return;
    setSectionColor(section, node);
    const title = section.querySelector('.tiled-section-title');
    if (title) title.textContent = node.title || '未命名节点';
    const meta = section.querySelector('.tiled-section-meta');
    if (meta) meta.textContent = `${(node.content || '').length} 字`;
  }

  async function renderStreamdownContent(nodeId, markdown, options: any = {}) {
    if (state.activeView !== 'tiled') return false;
    const contentEl = root.querySelector(`[data-node-id="${cssAttr(nodeId)}"] .tiled-content`) as HTMLElement | null;
    const hostEl = contentEl?.querySelector('.tiled-markdown-host') as HTMLElement | null;
    if (!contentEl || !hostEl) {
      updateNodeShell(nodeId);
      return false;
    }
    const pageState = ensurePageState(nodeId);
    const scrollState = captureContentScrollState(contentEl, nodeId);
    await renderStreamdownMarkdown(hostEl, markdown || '', { streaming: options.streaming !== false });
    restoreContentScroll(contentEl, pageState, scrollState);
    attachScrollIntent(nodeId, contentEl);
    updateNodeShell(nodeId);
    requestAnimationFrame(drawRelations);
    return true;
  }

  function captureContentScrollState(contentEl, nodeId) {
    const tailState = ensureTailState(nodeId, contentEl);
    return {
      nodeId,
      scrollTop: contentEl.scrollTop,
      followTail: tailState.followTail,
    };
  }

  function restoreContentScroll(contentEl, pageState, scrollState) {
    const restore = () => {
      if (scrollState.followTail) {
        scrollToContentBottom(contentEl);
      } else {
        contentEl.scrollTop = scrollState.scrollTop;
      }
      pageState.scrollTop = contentEl.scrollTop;
      updateTailState(scrollState.nodeId, contentEl);
    };
    restore();
    queueMicrotask(restore);
    requestAnimationFrame(restore);
  }

  function attachScrollIntent(nodeId, contentEl) {
    const tailState = ensureTailState(nodeId, contentEl);
    if (tailState.contentEl === contentEl && tailState.attached) return tailState;

    tailState.intersectionObserver?.disconnect();
    tailState.resizeObserver?.disconnect();
    tailState.contentEl = contentEl;
    tailState.attached = true;
    tailState.followTail = isNearContentBottom(contentEl);

    const sentinel = contentEl.querySelector('.tiled-bottom-sentinel');
    if (sentinel && 'IntersectionObserver' in window) {
      tailState.intersectionObserver = new IntersectionObserver((entries) => {
        tailState.followTail = entries.some((entry) => entry.isIntersecting) || isNearContentBottom(contentEl);
      }, { root: contentEl, threshold: 1 });
      tailState.intersectionObserver.observe(sentinel);
    }

    if ('ResizeObserver' in window) {
      tailState.resizeObserver = new ResizeObserver(() => {
        if (!tailState.followTail) return;
        scrollToContentBottom(contentEl);
        ensurePageState(nodeId).scrollTop = contentEl.scrollTop;
      });
      const host = contentEl.querySelector('.tiled-markdown-host') || contentEl;
      tailState.resizeObserver.observe(host);
      tailState.resizeObserver.observe(contentEl);
    }
    return tailState;
  }

  function disconnectTailState(nodeId) {
    const tailState = tailStateByNodeId.get(nodeId);
    if (!tailState) return;
    tailState.intersectionObserver?.disconnect();
    tailState.resizeObserver?.disconnect();
    tailState.attached = false;
    tailState.contentEl = null;
  }

  function ensureTailState(nodeId, contentEl = null) {
    let tailState = tailStateByNodeId.get(nodeId);
    if (!tailState) {
      tailState = { followTail: contentEl ? isNearContentBottom(contentEl) : true };
      tailStateByNodeId.set(nodeId, tailState);
    }
    return tailState;
  }

  function updateTailState(nodeId, contentEl) {
    const tailState = ensureTailState(nodeId, contentEl);
    tailState.followTail = isNearContentBottom(contentEl);
    return tailState;
  }

  function isNearContentBottom(contentEl) {
    return contentEl.scrollHeight - contentEl.clientHeight - contentEl.scrollTop <= 32;
  }

  function scrollToContentBottom(contentEl) {
    contentEl.scrollTop = Math.max(0, contentEl.scrollHeight - contentEl.clientHeight);
  }

  function handleClick(event) {
    const actionButton = (event.target as Element).closest('[data-tiled-action]') as HTMLElement | null;
    if (actionButton) {
      event.preventDefault();
      focusSection(actionButton.closest('.tiled-section') as HTMLElement | null);
      runAction(actionButton);
      return;
    }

    focusSection((event.target as Element).closest('.tiled-section') as HTMLElement | null);

    const annotated = (event.target as Element).closest('mark.annotated, .math-node.annotated-math') as HTMLElement | null;
    const targetId = annotated?.dataset.refId;
    if (targetId) {
      setActiveView('canvas');
      focusCanvasNode(targetId);
      return;
    }

    const header = (event.target as Element).closest('.tiled-section-header') as HTMLElement | null;
    const section = header?.closest('.tiled-section') as HTMLElement | null;
    const nodeId = section?.dataset.nodeId;
    if (nodeId) openFullscreen(nodeId);
  }

  function handleKeydown(event) {
    if (isEditableTarget(event.target)) return false;
    const key = event.key;
    const handledKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', '[', ']']);
    if (!handledKeys.has(key)) return false;

    if (event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      swapFocusedPanel(key);
    } else if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      moveFocus(key);
    } else if (key === ' ') {
      runFocusedAction('section-title-toggle');
    } else if (key === '[') {
      runFocusedAction('section-shorter');
    } else if (key === ']') {
      runFocusedAction('section-taller');
    }
    event.preventDefault();
    return true;
  }

  function moveFocus(key) {
    const workspace = ensureWorkspace();
    const columns = workspace.columns || [];
    if (columns.length === 0) return;
    const currentNodeId = workspace.focus?.nodeId;
    let columnIndex = Math.max(0, columns.findIndex((column) => column.pageIds.includes(currentNodeId)));
    if (columnIndex < 0) columnIndex = 0;
    let pageIndex = Math.max(0, columns[columnIndex].pageIds.indexOf(currentNodeId));

    let nextNodeId = '';
    if (key === 'ArrowLeft') {
      nextNodeId = getPrimaryParentNodeId(currentNodeId || columns[columnIndex].pageIds[pageIndex]);
    } else if (key === 'ArrowRight') {
      nextNodeId = getPrimaryChildNodeId(currentNodeId || columns[columnIndex].pageIds[pageIndex]);
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      nextNodeId = getNearestVerticalNodeId(currentNodeId || columns[columnIndex].pageIds[pageIndex], key);
      if (!nextNodeId) {
        pageIndex = key === 'ArrowUp'
          ? Math.max(0, pageIndex - 1)
          : Math.min(columns[columnIndex].pageIds.length - 1, pageIndex + 1);
      }
    }

    if (!nextNodeId) nextNodeId = columns[columnIndex].pageIds[Math.max(0, pageIndex)];
    if (!nextNodeId) return;
    const nextColumn = columns.find((column) => column.pageIds.includes(nextNodeId)) || columns[columnIndex];
    workspace.focus = { workspaceId: workspace.id, region: 'columns', columnId: nextColumn.id, nodeId: nextNodeId };
    workspace.updatedAt = new Date().toISOString();
    refreshLayoutPositions();
    root.querySelector(`[data-node-id="${cssAttr(nextNodeId)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function getNearestVerticalNodeId(nodeId, key) {
    if (!nodeId) return '';
    const workspace = ensureWorkspace();
    const projection = projectTiledColumns(state.nodes, state.edges, workspace);
    const current = projection.pageLayouts[nodeId];
    if (!current) return '';
    const candidates = Object.values(projection.pageLayouts)
      .filter((layout: any) => layout.nodeId !== nodeId && layout.depth === current.depth)
      .filter((layout: any) => key === 'ArrowUp' ? layout.order < current.order : layout.order > current.order)
      .sort((a: any, b: any) => key === 'ArrowUp' ? b.order - a.order : a.order - b.order);
    return (candidates[0] as any)?.nodeId || '';
  }

  function swapFocusedPanel(key) {
    const workspace = ensureWorkspace();
    const projection = projectTiledColumns(state.nodes, state.edges, workspace);
    workspace.columns = projection.columns;
    const nodeId = workspace.focus?.nodeId || workspace.columns[0]?.pageIds[0];
    if (!nodeId) return;
    const column = workspace.columns.find((item) => item.pageIds.includes(nodeId));
    const index = column?.pageIds.indexOf(nodeId) ?? -1;
    const swapIndex = key === 'ArrowUp' ? index - 1 : index + 1;
    if (!column || index < 0 || swapIndex < 0 || swapIndex >= column.pageIds.length) return;
    [column.pageIds[index], column.pageIds[swapIndex]] = [column.pageIds[swapIndex], column.pageIds[index]];
    workspace.focus = { workspaceId: workspace.id, region: 'columns', columnId: column.id, nodeId };
    workspace.updatedAt = new Date().toISOString();
    refreshLayoutPositions();
    root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function getPrimaryParentNodeId(nodeId) {
    if (!nodeId) return '';
    const incomingEdge = state.edges.find((edge) => edge.targetId === nodeId);
    if (incomingEdge?.sourceId && getNode(incomingEdge.sourceId)) return incomingEdge.sourceId;
    const node = getNode(nodeId);
    return node?.parentId && getNode(node.parentId) ? node.parentId : '';
  }

  function getPrimaryChildNodeId(nodeId) {
    if (!nodeId) return '';
    const outgoingEdge = state.edges.find((edge) => edge.sourceId === nodeId);
    if (outgoingEdge?.targetId && getNode(outgoingEdge.targetId)) return outgoingEdge.targetId;
    const child = state.nodes.find((node) => node.parentId === nodeId);
    return child?.id || '';
  }

  function animateRelations(duration = 320) {
    if (relationAnimationFrame) cancelAnimationFrame(relationAnimationFrame);
    const start = performance.now();
    const tick = () => {
      drawRelations();
      if (performance.now() - start < duration) {
        relationAnimationFrame = requestAnimationFrame(tick);
      } else {
        relationAnimationFrame = 0;
      }
    };
    relationAnimationFrame = requestAnimationFrame(tick);
  }

  function drawRelations() {
    const layer = root.querySelector('.tiled-relations-layer') as SVGSVGElement | null;
    if (!layer || state.activeView !== 'tiled') return;
    layer.innerHTML = '';
    const field = layer.closest('.tiled-field') as HTMLElement | null;
    const width = Math.max(field?.scrollWidth || 0, field?.offsetWidth || 0, root.clientWidth);
    const height = Math.max(field?.scrollHeight || 0, field?.offsetHeight || 0, root.clientHeight);
    layer.setAttribute('width', String(width));
    layer.setAttribute('height', String(height));
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);

    root.querySelectorAll('.tiled-section.related, .tiled-section.annotation-related').forEach((section) => {
      section.classList.remove('related', 'annotation-related');
    });

    const workspace = ensureWorkspace();
    const focusedId = workspace.focus?.nodeId || '';
    const structuralRelations = state.edges.map((edge) => ({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: 'structural',
      color: 'var(--md-sys-color-outline)',
    }));
    const annotationRelations = state.annotations.map((annotation) => ({
      sourceId: annotation.sourceNodeId,
      targetId: annotation.targetNodeId,
      type: 'annotation',
      color: `var(--hl-${((Number(annotation.colorIndex) || 0) % 5 + 5) % 5}-fg)`,
    }));

    for (const relation of [...structuralRelations, ...annotationRelations]) {
      if (!relation.sourceId || !relation.targetId || relation.sourceId === relation.targetId) continue;
      const source = getSectionAnchor(relation.sourceId, relation.type === 'annotation' ? relation.targetId : '');
      const target = getSectionAnchor(relation.targetId);
      if (!source || !target) continue;
      const active = focusedId && (relation.sourceId === focusedId || relation.targetId === focusedId);
      appendRelationPath(layer, source, target, relation.type, relation.color, Boolean(active));
      if (active) {
        source.section.classList.add(relation.type === 'annotation' ? 'annotation-related' : 'related');
        target.section.classList.add(relation.type === 'annotation' ? 'annotation-related' : 'related');
      }
    }
  }

  function getSectionAnchor(nodeId, targetId = '') {
    const section = root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`) as HTMLElement | null;
    if (!section) return null;
    const field = section.closest('.tiled-field') as HTMLElement | null;
    const fieldRect = (field || root).getBoundingClientRect();
    const anchorElement = targetId
      ? section.querySelector(`[data-ref-id="${cssAttr(targetId)}"]`) as HTMLElement | null
      : null;
    const rect = (anchorElement || section).getBoundingClientRect();
    return {
      x: rect.left - fieldRect.left + (field?.scrollLeft || 0) + rect.width / 2,
      y: rect.top - fieldRect.top + (field?.scrollTop || 0) + rect.height / 2,
      section,
    };
  }

  function appendRelationPath(layer, source, target, type, color, active) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const dx = Math.max(80, Math.abs(target.x - source.x) * 0.45);
    const c1x = source.x + (target.x >= source.x ? dx : -dx);
    const c2x = target.x - (target.x >= source.x ? dx : -dx);
    path.setAttribute('d', `M ${source.x} ${source.y} C ${c1x} ${source.y}, ${c2x} ${target.y}, ${target.x} ${target.y}`);
    path.setAttribute('class', `tiled-relation ${type}${active ? ' active' : ''}`);
    path.setAttribute('stroke', color);
    layer.appendChild(path);
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
    const workspace = ensureWorkspace();
    const column = workspace.columns.find((item) => item.pageIds.includes(nodeId));
    const changed = workspace.focus?.nodeId !== nodeId;
    workspace.focus = { workspaceId: workspace.id, region: 'columns', columnId: column?.id, nodeId };
    workspace.updatedAt = new Date().toISOString();
    if (changed) {
      refreshLayoutPositions();
    } else {
      root.querySelectorAll('.tiled-section.focused').forEach((item) => item.classList.remove('focused'));
      section.classList.add('focused');
      requestAnimationFrame(drawRelations);
    }
  }

  function scheduleLayoutRefresh() {
    if (pendingLayoutRefresh) return;
    pendingLayoutRefresh = requestAnimationFrame(() => {
      pendingLayoutRefresh = 0;
      if (state.activeView === 'tiled') refreshLayoutPositions();
    });
  }

  function handleScroll(event) {
    if (event.target === root) {
      if (!isAdjustingRootScroll) scheduleLayoutRefresh();
      requestAnimationFrame(drawRelations);
      return;
    }
    const content = (event.target as Element).closest?.('.tiled-content') as HTMLElement | null;
    const nodeId = content?.closest('.tiled-section')?.getAttribute('data-node-id');
    if (!content || !nodeId) return;
    updateTailState(nodeId, content);
    const pageState = ensurePageState(nodeId);
    pageState.scrollTop = content.scrollTop;
    requestAnimationFrame(drawRelations);
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
    handleKeydown,
    handleScroll,
    renderStreamdownContent,
    updateNodeShell,
  };
}
