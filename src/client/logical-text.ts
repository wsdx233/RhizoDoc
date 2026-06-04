import { clamp } from './utils.js';

export type LogicalTextUnit =
  | { type: 'text'; node: Text; text: string; start: number; end: number }
  | { type: 'math'; element: HTMLElement; text: string; start: number; end: number };

type PendingLogicalTextUnit =
  | { type: 'text'; node: Text; text: string }
  | { type: 'math'; element: HTMLElement; text: string };

type LogicalTextSegment = {
  from: number;
  to: number;
};

export type LogicalRangeSelection = {
  text: string;
  start: number;
  length: number;
};

export function getLogicalRangeSelection(container: Node, range: Range, rawText = ''): LogicalRangeSelection | null {
  const units = getLogicalTextUnits(container);
  let selectionStart: number | null = null;
  let logicalText = '';

  for (const unit of units) {
    const segment = getSelectedUnitSegment(unit, range);
    if (!segment || segment.to <= segment.from) continue;
    const segmentText = unit.text.slice(segment.from, segment.to);
    if (!segmentText) continue;
    if (selectionStart === null) selectionStart = unit.start + segment.from;
    logicalText += segmentText;
  }

  if (selectionStart !== null && logicalText.trim()) {
    const normalized = normalizeSelectionText(logicalText);
    if (normalized.text) {
      return {
        text: normalized.text,
        start: selectionStart + normalized.leading,
        length: normalized.text.length,
      };
    }
  }

  const offsets = getDomRangeOffsets(container, range);
  if (!offsets || offsets.length <= 0) return null;
  const normalized = normalizeSelectionText(rawText);
  if (!normalized.text) return null;
  return {
    text: normalized.text,
    start: offsets.start + normalized.leading,
    length: normalized.text.length,
  };
}

export function getLogicalText(container: Node): string {
  return getLogicalTextUnits(container).map((unit) => unit.text).join('');
}

export function getLogicalTextUnits(container: Node): LogicalTextUnit[] {
  const units: LogicalTextUnit[] = [];
  let cursor = 0;

  const addUnit = (unit: PendingLogicalTextUnit) => {
    const text = String(unit.text || '');
    units.push({ ...unit, text, start: cursor, end: cursor + text.length });
    cursor += text.length;
  };

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      addUnit({ type: 'text', node: node as Text, text: node.nodeValue || '' });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    if (element.classList?.contains('math-node')) {
      addUnit({ type: 'math', element, text: getMathLogicalText(element) });
      return;
    }

    Array.from(element.childNodes).forEach(visit);
  };

  visit(container);
  return units;
}

export function forEachLogicalTextSegment(
  container: Node,
  start: number,
  length: number,
  callback: (unit: LogicalTextUnit, from: number, to: number) => void,
) {
  if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) return;
  const end = start + length;
  for (const unit of getLogicalTextUnits(container)) {
    if (unit.end <= start || unit.start >= end) continue;
    const from = Math.max(0, start - unit.start);
    const to = Math.min(unit.text.length, end - unit.start);
    if (from < to) callback(unit, from, to);
  }
}

function normalizeSelectionText(rawText: unknown) {
  const text = String(rawText || '');
  const leading = text.match(/^\s*/)?.[0]?.length || 0;
  const trailing = text.match(/\s*$/)?.[0]?.length || 0;
  const trimmed = text.slice(leading, text.length - trailing);
  return { text: trimmed, leading, trailing };
}

function getSelectedUnitSegment(unit: LogicalTextUnit, range: Range): LogicalTextSegment | null {
  const target = unit.type === 'math' ? unit.element : unit.node;
  if (!rangeIntersectsNode(range, target)) return null;

  if (unit.type === 'math') {
    return { from: 0, to: unit.text.length };
  }

  const value = unit.text || '';
  let from = 0;
  let to = value.length;
  if (range.startContainer === unit.node) from = clamp(range.startOffset, 0, value.length);
  if (range.endContainer === unit.node) to = clamp(range.endOffset, 0, value.length);
  return from < to ? { from, to } : null;
}

function getDomRangeOffsets(container: Node, range: Range) {
  try {
    const before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    return { start, length: range.toString().length };
  } catch {
    return null;
  }
}

function getMathLogicalText(element: HTMLElement) {
  return element.dataset.mathSource || element.getAttribute('data-math-source') || element.textContent || '';
}

function rangeIntersectsNode(range: Range, node: Node) {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}
