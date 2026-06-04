import type { RhizoAnnotation } from '../shared/types.js';
import { getLogicalText, forEachLogicalTextSegment } from './logical-text.js';
import { cssAttr } from './utils.js';

export function applyAnnotationToContainer(container: Element | null | undefined, annotation: RhizoAnnotation) {
  if (!container) return;
  if (container.querySelector(`[data-annotation-id="${cssAttr(annotation.id)}"]`)) return;

  const totalText = getLogicalText(container);
  let start = Number(annotation.start);
  let length = Number(annotation.length);
  const storedText = annotation.text || '';

  if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0 || totalText.slice(start, start + length) !== storedText) {
    const index = storedText ? totalText.indexOf(storedText) : -1;
    if (index < 0) return;
    start = index;
    length = storedText.length;
  }

  wrapTextByOffset(container, start, length, annotation);
}

export function unwrapMarksForTarget(targetId: string) {
  document.querySelectorAll<HTMLElement>('mark.annotated').forEach((mark) => {
    if (mark.dataset.refId !== targetId) return;
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
  document.querySelectorAll<HTMLElement>('.math-node.annotated-math').forEach((mathEl) => {
    if (mathEl.dataset.refId !== targetId) return;
    mathEl.classList.remove('annotated-math');
    delete mathEl.dataset.refId;
    delete mathEl.dataset.annotationId;
    mathEl.style.backgroundColor = '';
    mathEl.style.color = '';
    mathEl.title = '';
  });
}

function wrapTextByOffset(container: Element, start: number, length: number, annotation: RhizoAnnotation) {
  forEachLogicalTextSegment(container, start, length, (unit, from, to) => {
    if (unit.type === 'math') {
      annotateMathElement(unit.element, annotation);
      return;
    }
    if (from < to) wrapTextNodeSegment(unit.node, from, to, annotation);
  });
}

function wrapTextNodeSegment(textNode: Text, from: number, to: number, annotation: RhizoAnnotation) {
  const value = textNode.nodeValue || '';
  const selectedText = value.slice(from, to);
  if (isTableStructuralWhitespace(textNode, selectedText)) return;

  const fragment = document.createDocumentFragment();
  if (from > 0) fragment.appendChild(document.createTextNode(value.slice(0, from)));

  const mark = document.createElement('mark');
  const colors = highlightColors(annotation.colorIndex);
  mark.className = 'annotated';
  mark.dataset.refId = annotation.targetNodeId;
  mark.dataset.annotationId = annotation.id;
  mark.style.backgroundColor = colors.bg;
  mark.style.color = colors.fg;
  mark.title = '点击定位到生成节点';
  mark.textContent = selectedText;
  fragment.appendChild(mark);

  if (to < value.length) fragment.appendChild(document.createTextNode(value.slice(to)));
  textNode.parentNode?.replaceChild(fragment, textNode);
}

function isTableStructuralWhitespace(textNode: Text, text: string) {
  if (text.trim()) return false;
  return Boolean(textNode.parentElement?.matches('table, thead, tbody, tfoot, tr, colgroup'));
}

function annotateMathElement(element: HTMLElement, annotation: RhizoAnnotation) {
  if (!element) return;
  const colors = highlightColors(annotation.colorIndex);
  element.classList.add('annotated-math');
  element.dataset.refId = annotation.targetNodeId;
  element.dataset.annotationId = annotation.id;
  element.style.backgroundColor = colors.bg;
  element.style.color = colors.fg;
  element.title = '点击定位到生成节点';
}

function highlightColors(colorIndex: number) {
  const index = ((Number(colorIndex) || 0) % 5 + 5) % 5;
  return { bg: `var(--hl-${index}-bg)`, fg: `var(--hl-${index}-fg)` };
}
