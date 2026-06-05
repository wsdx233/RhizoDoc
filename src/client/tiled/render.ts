import { applyAnnotationToContainer } from '../annotations.js';
import { renderStreamdownMarkdown } from '../streamdown-renderer.js';
import { cssAttr } from '../utils.js';

type TiledRenderControllerOptions = {
  root: HTMLElement;
  state: any;
  getNode: (id: string) => any;
  attachScrollIntent: (nodeId: string, contentEl: HTMLElement) => unknown;
  onContentAnchorsChanged?: (nodeId: string) => void;
};

export function createTiledRenderController(options: TiledRenderControllerOptions) {
  const { root, state, getNode, attachScrollIntent, onContentAnchorsChanged } = options;

  function createField(fieldWidth: number, fieldHeight: number, fieldOffsetY: number) {
    const fieldEl = document.createElement('div');
    fieldEl.className = 'tiled-field';
    fieldEl.style.width = `${fieldWidth}px`;
    fieldEl.style.height = `${fieldHeight}px`;
    fieldEl.dataset.stackOffsetY = String(fieldOffsetY);
    fieldEl.innerHTML = '<svg class="tiled-relations-layer" aria-hidden="true"></svg>';
    return fieldEl;
  }

  function renderColumn(column, laneX: number, fieldHeight: number) {
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
    return columnEl;
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
    header.querySelector('.tiled-section-title')!.textContent = node.title || '未命名节点';
    header.querySelector('.tiled-section-meta')!.textContent = `${(node.content || '').length} 字`;
    section.appendChild(header);

    if (display !== 'title') {
      const content = document.createElement('div');
      content.className = 'tiled-content markdown-body';
      const host = document.createElement('div');
      host.className = 'tiled-markdown-host';
      renderStreamdownMarkdown(host, node.content || '', { streaming: false }).then(() => {
        if (!host.isConnected) return;
        const nodeAnnotations = state.annotations.filter((annotation) => annotation.sourceNodeId === node.id);
        nodeAnnotations.forEach((annotation) => applyAnnotationToContainer(host, annotation));
        if (nodeAnnotations.length > 0) onContentAnchorsChanged?.(node.id);
      });
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

  function setSectionColor(section: HTMLElement, node) {
    section.style.setProperty('--node-color', node.colorIndex >= 0
      ? `var(--hl-${node.colorIndex % 5}-bg)`
      : 'var(--md-sys-color-surface-container-high)');
  }

  function updateNodeShell(nodeId: string) {
    const node = getNode(nodeId);
    const section = root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`) as HTMLElement | null;
    if (!node || !section) return;
    setSectionColor(section, node);
    const title = section.querySelector('.tiled-section-title');
    if (title) title.textContent = node.title || '未命名节点';
    const meta = section.querySelector('.tiled-section-meta');
    if (meta) meta.textContent = `${(node.content || '').length} 字`;
  }

  return {
    createField,
    renderColumn,
    renderSection,
    updateNodeShell,
  };
}
