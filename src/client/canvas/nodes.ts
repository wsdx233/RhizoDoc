import { applyAnnotationToContainer } from '../annotations.js';
import { postProcessNodeContent, renderMarkdown } from '../markdown.js';
import { unmountStreamdownMarkdown } from '../streamdown-renderer.js';
import { clamp } from '../utils.js';
import { NODE_COLLAPSE_HEIGHT, NODE_MAX_WIDTH, NODE_MIN_WIDTH, NODE_WIDTH } from './constants.js';

export function createCanvasNodesController(options: {
  nodesLayer: HTMLElement;
  state: any;
  getNode: (id: string) => any;
  isNodeSelected: (id: string) => boolean;
  canvasWorkspace: any;
  tiledWorkspace: any;
  shouldPreserveNodeContentForSelection: (nodeId: string) => boolean;
  syncFullscreenContent: (nodeId: string, options?: any) => void;
}) {
  const { nodesLayer, state, getNode, isNodeSelected, canvasWorkspace, tiledWorkspace, shouldPreserveNodeContentForSelection, syncFullscreenContent } = options;

  function renderAll() {
    nodesLayer.innerHTML = '';
    for (const node of state.nodes) renderNode(node);
  }

  function renderNode(node: any) {
    const nodeEl = document.createElement('article');
    nodeEl.id = node.id;
    nodeEl.dataset.nodeId = node.id;
    nodeEl.className = 'node';
    nodeEl.classList.toggle('selected', isNodeSelected(node.id));
    nodeEl.innerHTML = `
      <div class="node-header" title="拖拽移动节点；按住 Shift 可从内容区拖动">
        <div class="node-title-group">
          <span class="material-symbols-outlined node-icon">description</span>
          <span class="node-title"></span>
        </div>
        <div class="node-actions" aria-label="节点操作">
          <button class="node-btn" data-node-action="fullscreen" title="全屏查看"><span class="material-symbols-outlined">fullscreen</span></button>
          <button class="node-btn" data-node-action="toggle" title="展开/收起"><span class="material-symbols-outlined">unfold_less</span></button>
          <button class="node-btn resize-handle" data-node-action="resize" title="拖拽调整宽度"><span class="material-symbols-outlined">drag_indicator</span></button>
        </div>
      </div>
      <div class="node-content-wrapper">
        <div class="node-content markdown-body"></div>
        <div class="node-content-mask"></div>
      </div>
      <button class="expand-btn" data-node-action="toggle"><span class="expand-label">展开全部</span> <span class="material-symbols-outlined">keyboard_arrow_down</span></button>
      <div class="node-meta"><span class="node-kind"></span><span class="node-count"></span></div>
    `;
    nodesLayer.appendChild(nodeEl);
    updateElement(node.id);
  }

  function updateElement(id: string, { contentHtml = null, preserveContent = false }: any = {}) {
    const node = getNode(id);
    const nodeEl = document.getElementById(id);
    if (!node || !nodeEl) return;

    nodeEl.classList.toggle('selected', isNodeSelected(id));
    node.width = clamp(Number(node.width) || NODE_WIDTH, NODE_MIN_WIDTH, NODE_MAX_WIDTH);
    nodeEl.style.left = `${node.x}px`;
    nodeEl.style.top = `${node.y}px`;
    nodeEl.style.width = `${node.width}px`;
    nodeEl.dataset.dir = node.dir || 'right';
    nodeEl.style.setProperty('--node-color', node.colorIndex >= 0
      ? `var(--hl-${node.colorIndex % 5}-bg)`
      : 'var(--md-sys-color-surface-container-high)');
    nodeEl.classList.toggle('loading', Boolean(node.loading));

    const icon = nodeEl.querySelector('.node-icon');
    if (icon) icon.textContent = node.loading ? 'hourglass_top' : (node.llm ? 'auto_awesome' : 'description');
    const title = nodeEl.querySelector('.node-title');
    if (title) title.textContent = node.title || '未命名节点';

    const contentEl = nodeEl.querySelector('.node-content') as HTMLElement | null;
    if (contentEl && !preserveContent) {
      unmountStreamdownMarkdown(contentEl);
      contentEl.innerHTML = contentHtml ?? renderMarkdown(node.content || '');
      postProcessNodeContent(contentEl);
      applyAnnotationsForSourceNode(node.id);
    }
    updateCollapseState(node.id);

    const kind = nodeEl.querySelector('.node-kind');
    if (kind) kind.textContent = node.llm ? 'AI / Markdown' : '文档 / Markdown';
    const count = nodeEl.querySelector('.node-count');
    if (count) count.textContent = `${(node.content || '').length} 字`;

    requestAnimationFrame(() => {
      if (state.fullscreenNodeId === node.id && !preserveContent) syncFullscreenContent(node.id, { contentHtml });
      canvasWorkspace.drawEdges();
      canvasWorkspace.updateMinimap();
      if (state.activeView === 'tiled') {
        if (preserveContent) tiledWorkspace.updateNodeShell(node.id);
        else tiledWorkspace.render();
      }
    });
  }

  function updateElementPreservingActiveSelection(id: string, options: any = {}) {
    if (shouldPreserveNodeContentForSelection(id)) {
      state.deferredRenderNodeIds.add(id);
      state.deferredRenderPayloads.set(id, { renderer: 'static', options });
      updateElement(id, { ...options, preserveContent: true });
      return true;
    }
    state.deferredRenderNodeIds.delete(id);
    state.deferredRenderPayloads.delete(id);
    updateElement(id, options);
    return false;
  }

  function updateCollapseState(id: string) {
    const node = getNode(id);
    const nodeEl = document.getElementById(id);
    const contentEl = nodeEl?.querySelector('.node-content') as HTMLElement | null;
    if (!node || !nodeEl || !contentEl) return;

    nodeEl.style.setProperty('--node-collapse-height', `${NODE_COLLAPSE_HEIGHT}px`);
    const isLong = contentEl.scrollHeight > NODE_COLLAPSE_HEIGHT + 8;
    const effectiveCollapsed = isLong && Boolean(node.collapsed);
    nodeEl.classList.toggle('collapsible', isLong);
    nodeEl.classList.toggle('collapsed', effectiveCollapsed);
    nodeEl.classList.toggle('expanded', isLong && !effectiveCollapsed);

    const toggleBtn = nodeEl.querySelector('[data-node-action="toggle"]') as HTMLElement | null;
    const toggleIcon = toggleBtn?.querySelector('.material-symbols-outlined');
    if (toggleBtn && toggleIcon) {
      toggleIcon.textContent = effectiveCollapsed ? 'unfold_more' : 'unfold_less';
      toggleBtn.title = effectiveCollapsed ? '展开内容' : '收起内容';
    }
    const expandBtn = nodeEl.querySelector('.expand-btn') as HTMLElement | null;
    if (toggleBtn) {
      toggleBtn.style.display = isLong ? 'inline-flex' : 'none';
      toggleBtn.setAttribute('aria-hidden', isLong ? 'false' : 'true');
    }
    if (expandBtn) {
      expandBtn.innerHTML = '<span class="expand-label">展开全部</span> <span class="material-symbols-outlined">keyboard_arrow_down</span>';
      expandBtn.style.display = isLong && effectiveCollapsed ? 'flex' : 'none';
      expandBtn.setAttribute('aria-hidden', isLong && effectiveCollapsed ? 'false' : 'true');
    }
  }

  function toggleCollapse(id: string, forceCollapsed = null) {
    const node = getNode(id);
    const nodeEl = document.getElementById(id);
    if (!node) return false;
    if (nodeEl && !nodeEl.classList.contains('collapsible')) return false;
    const nextCollapsed = typeof forceCollapsed === 'boolean' ? forceCollapsed : !node.collapsed;
    if (node.collapsed === nextCollapsed) return false;
    node.collapsed = nextCollapsed;
    node.updatedAt = new Date().toISOString();
    updateCollapseState(id);
    setTimeout(() => {
      canvasWorkspace.drawEdges();
      canvasWorkspace.updateMinimap();
    }, 180);
    return true;
  }

  function toggleManyCollapse(ids: string[], forceCollapsed = null) {
    const targets = uniqueNodeIds(ids).filter((id) => {
      const nodeEl = document.getElementById(id);
      return nodeEl?.classList.contains('collapsible');
    });
    if (targets.length === 0) return;

    const shouldCollapse = typeof forceCollapsed === 'boolean' ? forceCollapsed : targets.some((id) => !getNode(id)?.collapsed);
    let changed = false;
    for (const id of targets) changed = toggleCollapse(id, shouldCollapse) || changed;
    if (!changed) {
      canvasWorkspace.drawEdges();
      canvasWorkspace.updateMinimap();
    }
  }

  function applyAnnotationsForSourceNode(sourceNodeId: string) {
    state.annotations
      .filter((annotation: any) => annotation.sourceNodeId === sourceNodeId)
      .forEach(applyAnnotation);
  }

  function applyAnnotation(annotation: any) {
    const sourceEl = document.getElementById(annotation.sourceNodeId);
    const container = sourceEl?.querySelector('.node-content');
    applyAnnotationToContainer(container, annotation);
  }

  function uniqueNodeIds(ids: string[]) {
    const seen = new Set();
    const result: string[] = [];
    for (const id of ids || []) {
      if (!id || seen.has(id) || !getNode(id)) continue;
      seen.add(id);
      result.push(id);
    }
    return result;
  }

  return {
    renderAll,
    renderNode,
    updateElement,
    updateElementPreservingActiveSelection,
    updateCollapseState,
    toggleCollapse,
    toggleManyCollapse,
    applyAnnotationsForSourceNode,
    applyAnnotation,
  };
}
