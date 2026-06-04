import type { RhizoDomRefs } from './dom.js';
import { forEachLogicalTextSegment, getLogicalRangeSelection } from './logical-text.js';
import { clamp, closestElement, cssAttr } from './utils.js';

type SelectionControllerOptions = {
  dom: RhizoDomRefs;
  state: any;
  getNode: (id: string) => any;
  nodeRendering: any;
  hideMenus: () => void;
  submitSelection: () => void;
};

export function createSelectionController(options: SelectionControllerOptions) {
  const { dom, state, getNode, nodeRendering, hideMenus, submitSelection } = options;

  function handleSelection() {
    if (state.isDragging || state.isDraggingNode || state.isResizing || state.isMarqueeSelecting || state.isMoveMode || state.isMultiSelectMode) return;
    if (!dom.llmModal.classList.contains('hidden') || !dom.welcomeModal.classList.contains('hidden')) return;

    const selection = window.getSelection();
    const rawText = selection?.toString() || '';
    if (!selection || selection.rangeCount === 0 || rawText.trim().length === 0) {
      if (state.isNativeTextSelecting) return;
      if (state.keepTooltipAfterSelectionClear) {
        state.keepTooltipAfterSelectionClear = false;
        return;
      }
      if (dom.tooltip.style.display === 'flex') return;
      if (!dom.tooltip.classList.contains('focus')) hideTooltip();
      return;
    }

    const range = selection.getRangeAt(0);
    const contentEl = closestElement<HTMLElement>(range.commonAncestorContainer, '.node-content, .fs-content, .tiled-content');
    if (!contentEl) return;

    const fsSourceId = contentEl.classList.contains('fs-content') ? contentEl.dataset.sourceId : '';
    const tiledSection = contentEl.classList.contains('tiled-content') ? contentEl.closest('.tiled-section') as HTMLElement | null : null;
    const tiledSourceId = tiledSection?.dataset.nodeId || '';
    const nodeEl = contentEl.closest('.node');
    const parentNodeId = fsSourceId || tiledSourceId || nodeEl?.id;
    if (!parentNodeId || !getNode(parentNodeId)) return;

    const logicalSelection = getLogicalRangeSelection(contentEl, range, rawText);
    if (!logicalSelection || logicalSelection.length <= 0) return;

    state.currentSelection = {
      text: logicalSelection.text,
      parentNodeId,
      start: logicalSelection.start,
      length: logicalSelection.length,
      source: fsSourceId ? 'fullscreen' : (tiledSourceId ? 'tiled' : 'node'),
    };

    if (state.isNativeTextSelecting) return;

    const rect = range.getBoundingClientRect();
    dom.tooltip.style.display = 'flex';
    dom.tooltip.style.left = `${clamp(rect.left + rect.width / 2, 120, window.innerWidth - 120)}px`;
    dom.tooltip.style.top = `${Math.max(76, rect.top - 14)}px`;
    dom.promptInput.value = '';
  }

  function shouldLockNativeSelectionMenu() {
    if (dom.tooltip.style.display !== 'flex' || dom.tooltip.classList.contains('focus')) return false;
    if (!state.currentSelection?.parentNodeId || !state.currentSelection.text) return false;
    const selection = window.getSelection();
    return Boolean(selection && selection.rangeCount > 0 && selection.toString().trim());
  }

  function lockNativeSelectionMenu() {
    if (!shouldLockNativeSelectionMenu()) return;
    retainTemporarySelection();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    state.keepTooltipAfterSelectionClear = true;
    selection.removeAllRanges();
  }

  function retainTemporarySelection() {
    const selection = state.currentSelection;
    if (!selection?.parentNodeId || !selection.text) return;
    clearTemporarySelection();

    const container = selection.source === 'fullscreen' && state.fullscreenNodeId === selection.parentNodeId
      ? dom.fsContent
      : selection.source === 'tiled'
        ? dom.tiledWorkspace.querySelector(`[data-node-id="${cssAttr(selection.parentNodeId)}"] .tiled-content`)
        : document.getElementById(selection.parentNodeId)?.querySelector('.node-content');
    if (!container) return;
    wrapTemporarySelectionByOffset(container, Number(selection.start), Number(selection.length));
  }

  function wrapTemporarySelectionByOffset(container: Element, start: number, length: number) {
    forEachLogicalTextSegment(container, start, length, (unit, from, to) => {
      if (unit.type === 'math') {
        unit.element.classList.add('retained-math-selection');
        return;
      }
      if (from < to) wrapTemporaryTextNodeSegment(unit.node, from, to);
    });
  }

  function wrapTemporaryTextNodeSegment(textNode: Text, from: number, to: number) {
    const value = textNode.nodeValue || '';
    const selectedText = value.slice(from, to);
    if (!selectedText.trim() || isTableStructuralWhitespaceTextNode(textNode, selectedText)) return;

    const leading = selectedText.match(/^\s*/)?.[0] || '';
    const trailing = selectedText.match(/\s*$/)?.[0] || '';
    const core = selectedText.slice(leading.length, selectedText.length - trailing.length);
    if (!core) return;

    const fragment = document.createDocumentFragment();
    if (from > 0) fragment.appendChild(document.createTextNode(value.slice(0, from)));
    if (leading) fragment.appendChild(document.createTextNode(leading));

    const span = document.createElement('span');
    span.className = 'retained-selection';
    span.textContent = core;
    fragment.appendChild(span);

    if (trailing) fragment.appendChild(document.createTextNode(trailing));
    if (to < value.length) fragment.appendChild(document.createTextNode(value.slice(to)));
    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  function isTableStructuralWhitespaceTextNode(textNode: Text, text: string) {
    if (String(text || '').trim()) return false;
    return Boolean(textNode.parentElement?.matches?.('table, thead, tbody, tfoot, tr, colgroup'));
  }

  function clearTemporarySelection() {
    document.querySelectorAll('.retained-selection').forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
    document.querySelectorAll('.math-node.retained-math-selection').forEach((mathEl) => {
      mathEl.classList.remove('retained-math-selection');
    });
  }

  function hideTooltip({ preserveNativeSelection = false }: any = {}) {
    const deferredNodeId = state.currentSelection?.parentNodeId || null;
    if (!preserveNativeSelection) state.isNativeTextSelecting = false;
    clearTemporarySelection();
    dom.tooltip.style.display = 'none';
    dom.tooltip.classList.remove('focus');
    if (!preserveNativeSelection) window.getSelection()?.removeAllRanges();
    state.currentSelection = { text: '', parentNodeId: null, start: 0, length: 0, source: 'node' };
    void nodeRendering.flushDeferred(deferredNodeId, { force: true });
  }

  function handleDocumentMouseUp(event: MouseEvent) {
    const wasNativeTextSelecting = state.isNativeTextSelecting;
    if (!wasNativeTextSelecting && shouldLockNativeSelectionMenu()) {
      event.preventDefault();
      lockNativeSelectionMenu();
    }
    setTimeout(() => {
      if (wasNativeTextSelecting) {
        state.isNativeTextSelecting = false;
        handleSelection();
        return;
      }
      lockNativeSelectionMenu();
    }, 0);
  }

  function handleDocumentMouseDown(event: MouseEvent) {
    const target = event.target as Element;
    state.isNativeTextSelecting = event.button === 0
      && !state.isMoveMode
      && !state.isMultiSelectMode
      && Boolean(target.closest('.node-content, .fs-content, .tiled-content'));
    if (!target.closest('#action-tooltip') && target.closest('.node-content, .fs-content, .tiled-content')) {
      hideTooltip({ preserveNativeSelection: state.isNativeTextSelecting });
    }
    if (!target.closest('#action-tooltip') && !target.closest('.node') && !target.closest('.fullscreen-container') && !target.closest('#tiled-workspace')) hideTooltip();
    if (!target.closest('.context-menu')) hideMenus();
  }

  function focusTooltipPrompt() {
    dom.tooltip.classList.add('focus');
    dom.promptInput.focus();
  }

  function handlePromptFocus() {
    dom.tooltip.classList.add('focus');
  }

  function handlePromptBlur() {
    dom.tooltip.classList.remove('focus');
  }

  function handlePromptKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') submitSelection();
    if (event.key === 'Escape') hideTooltip();
  }

  return {
    handleSelection,
    handleDocumentMouseUp,
    handleDocumentMouseDown,
    focusTooltipPrompt,
    handlePromptFocus,
    handlePromptBlur,
    handlePromptKeydown,
    clearTemporarySelection,
    hideTooltip,
  };
}
