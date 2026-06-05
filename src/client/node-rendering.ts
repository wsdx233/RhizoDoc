import { applyAnnotationToContainer } from './annotations.js';
import type { RhizoDomRefs } from './dom.js';
import { renderStreamdownMarkdown, unmountStreamdownMarkdown } from './streamdown-renderer.js';
import { closestElement } from './utils.js';

type NodeRenderCoordinatorOptions = {
  dom: RhizoDomRefs;
  state: any;
  getNode: (id: string) => any;
};

export function createNodeRenderCoordinator(options: NodeRenderCoordinatorOptions) {
  const { dom, state, getNode } = options;
  let canvasNodes: any = null;
  let tiledWorkspace: any = null;

  function attachControllers(controllers: { canvasNodes?: any; tiledWorkspace?: any }) {
    if (controllers.canvasNodes) canvasNodes = controllers.canvasNodes;
    if (controllers.tiledWorkspace) tiledWorkspace = controllers.tiledWorkspace;
  }

  async function renderStreamdownContent(id: string, markdown: string, options: any = {}) {
    const streaming = options.streaming !== false;
    if (!options.force && shouldPreserveContentForSelection(id)) {
      state.deferredRenderNodeIds.add(id);
      state.deferredRenderPayloads.set(id, { renderer: 'streamdown', markdown: markdown || '', streaming });
      canvasNodes?.updateElement(id, { preserveContent: true });
      return false;
    }

    const nodeEl = document.getElementById(id);
    const contentEl = nodeEl?.querySelector('.node-content') as HTMLElement | null;
    if (!contentEl) return false;

    state.deferredRenderNodeIds.delete(id);
    state.deferredRenderPayloads.delete(id);
    await renderStreamdownMarkdown(contentEl, markdown || '', { streaming });
    if (state.fullscreenNodeId === id) await renderStreamdownMarkdown(dom.fsContent, markdown || '', { streaming });
    await tiledWorkspace?.renderStreamdownContent(id, markdown || '', { streaming });
    canvasNodes?.updateElement(id, { preserveContent: true });
    return true;
  }

  function shouldPreserveContentForSelection(nodeId: string) {
    if (!nodeId) return false;
    if (state.currentSelection?.parentNodeId === nodeId && state.currentSelection.text && dom.tooltip.style.display === 'flex') return true;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) return false;
    const range = selection.getRangeAt(0);
    const contentEl = closestElement<HTMLElement>(range.commonAncestorContainer, '.node-content, .fs-content, .tiled-content');
    if (!contentEl) return false;
    const fullscreenSourceId = contentEl.classList.contains('fs-content') ? contentEl.dataset.sourceId : '';
    const tiledSection = contentEl.classList.contains('tiled-content') ? contentEl.closest('.tiled-section') as HTMLElement | null : null;
    const tiledSourceId = tiledSection?.dataset.nodeId || '';
    const selectedNodeId = fullscreenSourceId || tiledSourceId || contentEl.closest('.node')?.id || '';
    return selectedNodeId === nodeId;
  }

  function flushDeferred(nodeId: string | null = null, { force = false }: any = {}) {
    const ids = nodeId ? [nodeId] : Array.from(state.deferredRenderNodeIds);
    const pending = [];
    for (const id of ids) {
      if (!id || !state.deferredRenderNodeIds.has(id)) continue;
      if (!force && shouldPreserveContentForSelection(id as string)) continue;
      const payload = state.deferredRenderPayloads.get(id);
      state.deferredRenderNodeIds.delete(id);
      state.deferredRenderPayloads.delete(id);
      if (payload?.renderer === 'streamdown') {
        pending.push(renderStreamdownContent(id as string, payload.markdown || '', { streaming: payload.streaming, force: true }));
      } else {
        canvasNodes?.updateElement(id, payload?.options || {});
      }
    }
    return Promise.all(pending);
  }

  async function syncFullscreenContent(id: string) {
    const node = getNode(id);
    if (!node || state.fullscreenNodeId !== id) return;
    if (shouldPreserveContentForSelection(id)) {
      state.deferredRenderNodeIds.add(id);
      state.deferredRenderPayloads.set(id, { renderer: 'static', options: {} });
      return;
    }
    unmountStreamdownMarkdown(dom.fsContent);
    await renderStreamdownMarkdown(dom.fsContent, node.content || '', { streaming: false });
    state.annotations
      .filter((annotation: any) => annotation.sourceNodeId === id)
      .forEach((annotation: any) => applyAnnotationToContainer(dom.fsContent, annotation));
  }

  return {
    attachControllers,
    renderStreamdownContent,
    shouldPreserveContentForSelection,
    flushDeferred,
    syncFullscreenContent,
  };
}
