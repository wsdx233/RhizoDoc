import type { RhizoAnnotation, RhizoNode, TiledPageLayout } from '../../shared/types.js';
import { clamp, cssAttr } from '../utils.js';
import { computeAnnotationSalience, type AnnotationSalienceSide } from './annotation-salience.js';
import { getTiledTitleAnchorId } from './relation-index.js';

export type TiledAnchorKind = 'visible-content' | 'annotation-span' | 'visible-panel';
export type TiledAnchorVisibility = 'visible' | 'above-viewport' | 'below-viewport';

export type TiledLayoutAnchor = {
  nodeId: string;
  kind: TiledAnchorKind;
  top: number;
  bottom: number;
  center: number;
  visibility: TiledAnchorVisibility;
  offscreenDistance?: number;
  salience?: number;
  salienceSide?: AnnotationSalienceSide;
  anchorRatio?: number;
  contentTop?: number;
  contentBottom?: number;
  visibleTop?: number;
  visibleBottom?: number;
  annotationId?: string;
  targetNodeId?: string;
};

export type TiledAnchorRegistry = {
  focusNodeId?: string;
  nodeAnchors: Record<string, TiledLayoutAnchor>;
  annotationAnchors: Record<string, TiledLayoutAnchor>;
};

type MeasureTiledAnchorsOptions = {
  root: HTMLElement;
  focusNodeId?: string;
  focusedLayout?: TiledPageLayout | null;
  layouts?: TiledPageLayout[];
  annotations?: RhizoAnnotation[];
  nodes?: RhizoNode[];
};

export function measureTiledAnchors(options: MeasureTiledAnchorsOptions): TiledAnchorRegistry | undefined {
  const registry: TiledAnchorRegistry = { focusNodeId: options.focusNodeId || undefined, nodeAnchors: {}, annotationAnchors: {} };
  const focusNodeId = options.focusNodeId || '';
  const layouts = options.layouts?.length
    ? options.layouts
    : focusNodeId && options.focusedLayout
      ? [options.focusedLayout]
      : [];
  for (const layout of layouts) {
    const section = findTiledSection(options.root, layout.nodeId);
    const anchor = section
      ? measureVisibleContentAnchor(options.root, section, layout.height)
        ?? measureVisiblePanelAnchor(options.root, section, layout.height)
      : undefined;
    if (anchor) registry.nodeAnchors[layout.nodeId] = anchor;
  }

  for (const annotation of options.annotations || []) {
    const anchor = measureAnnotationAnchor(options.root, annotation);
    if (anchor) registry.annotationAnchors[annotation.id] = anchor;
  }

  const nodesById = new Map((options.nodes || []).map((node) => [node.id, node]));
  for (const node of options.nodes || []) {
    const parentId = typeof node.parentId === 'string' ? node.parentId : '';
    if (!node.generated || !parentId || !nodesById.has(parentId)) continue;
    const anchorId = getTiledTitleAnchorId(parentId, node.id);
    const anchor = measureTitleAnchor(options.root, parentId, node.id);
    if (anchor) registry.annotationAnchors[anchorId] = anchor;
  }

  return Object.keys(registry.nodeAnchors).length || Object.keys(registry.annotationAnchors).length ? registry : undefined;
}

function findTiledSection(root: HTMLElement, nodeId: string) {
  return root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`) as HTMLElement | null;
}

function measureVisibleContentAnchor(_root: HTMLElement, section: HTMLElement, fallbackHeight: number): TiledLayoutAnchor | null {
  const content = section.querySelector('.tiled-content') as HTMLElement | null;
  if (!content || content.clientHeight <= 1) return null;
  const contentTop = getElementTopInSection(content, section);
  return createAnchorFromSectionInterval(section, 'visible-content', contentTop, contentTop + content.clientHeight, fallbackHeight);
}

function measureTitleAnchor(root: HTMLElement, sourceNodeId: string, targetNodeId: string): TiledLayoutAnchor | null {
  const section = findTiledSection(root, sourceNodeId);
  if (!section) return null;
  const header = section.querySelector('.tiled-section-header') as HTMLElement | null;
  if (!header) return null;
  const top = getElementTopInSection(header, section);
  const bottom = top + (header.offsetHeight || 1);
  return createAnchorFromSectionInterval(section, 'annotation-span', top, bottom, section.offsetHeight || 0, undefined, 'visible', undefined, undefined, undefined, undefined, undefined, undefined, {
    annotationId: getTiledTitleAnchorId(sourceNodeId, targetNodeId),
    targetNodeId,
  });
}

function measureVisiblePanelAnchor(_root: HTMLElement, section: HTMLElement, fallbackHeight: number): TiledLayoutAnchor | null {
  const height = section.offsetHeight || fallbackHeight;
  if (height <= 1) return null;
  return createAnchorFromSectionInterval(section, 'visible-panel', 0, height, fallbackHeight);
}

function measureAnnotationAnchor(root: HTMLElement, annotation: RhizoAnnotation): TiledLayoutAnchor | null {
  if (!annotation.id || !annotation.sourceNodeId) return null;
  const section = findTiledSection(root, annotation.sourceNodeId);
  if (!section) return null;
  const element = section.querySelector(`[data-annotation-id="${cssAttr(annotation.id)}"]`) as HTMLElement | null;
  if (!element) return null;

  const content = element.closest('.tiled-content') as HTMLElement | null;
  if (!content || content.clientHeight <= 1) return null;

  const contentTopInSection = getElementTopInSection(content, section);
  const elementRect = element.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();
  const elementTopInContent = elementRect.top - contentRect.top + content.scrollTop;
  const elementBottomInContent = elementTopInContent + elementRect.height;
  const viewportTopInContent = content.scrollTop;
  const viewportBottomInContent = content.scrollTop + content.clientHeight;

  const salience = computeAnnotationSalience({
    annotationTop: elementTopInContent,
    annotationBottom: elementBottomInContent,
    visibleTop: viewportTopInContent,
    visibleBottom: viewportBottomInContent,
  });
  const visibleTopInContent = Math.max(elementTopInContent, viewportTopInContent);
  const visibleBottomInContent = Math.min(elementBottomInContent, viewportBottomInContent);
  if (visibleBottomInContent > visibleTopInContent + 1) {
    return createAnchorFromSectionInterval(
      section,
      'annotation-span',
      contentTopInSection + visibleTopInContent - content.scrollTop,
      contentTopInSection + visibleBottomInContent - content.scrollTop,
      section.offsetHeight || 0,
      annotation,
      'visible',
      undefined,
      salience,
      elementTopInContent,
      elementBottomInContent,
      viewportTopInContent,
      viewportBottomInContent,
    );
  }

  const visibility: TiledAnchorVisibility = salience.side === 'above' ? 'above-viewport' : 'below-viewport';
  const clampedCenterInSection = contentTopInSection + (visibility === 'above-viewport' ? 0 : content.clientHeight);
  const offscreenDistance = visibility === 'above-viewport'
    ? Math.max(0, viewportTopInContent - elementBottomInContent)
    : Math.max(0, elementTopInContent - viewportBottomInContent);
  return createAnchorFromSectionInterval(
    section,
    'annotation-span',
    clampedCenterInSection,
    clampedCenterInSection,
    section.offsetHeight || 0,
    annotation,
    visibility,
    offscreenDistance,
    salience,
    elementTopInContent,
    elementBottomInContent,
    viewportTopInContent,
    viewportBottomInContent,
  );
}

function createAnchorFromSectionInterval(
  section: HTMLElement,
  kind: TiledAnchorKind,
  sectionTop: number,
  sectionBottom: number,
  fallbackHeight: number,
  annotation?: RhizoAnnotation,
  visibility: TiledAnchorVisibility = 'visible',
  offscreenDistance?: number,
  salience?: ReturnType<typeof computeAnnotationSalience>,
  contentTop?: number,
  contentBottom?: number,
  visibleTop?: number,
  visibleBottom?: number,
  synthetic?: { annotationId?: string; targetNodeId?: string },
): TiledLayoutAnchor {
  const height = section.offsetHeight || fallbackHeight || 1;
  const top = clamp(sectionTop, 0, height);
  const bottom = clamp(sectionBottom, 0, height);
  const center = clamp((top + bottom) / 2, 0, height);
  return {
    nodeId: annotation?.sourceNodeId || section.dataset.nodeId || '',
    kind,
    top,
    bottom,
    center,
    visibility,
    offscreenDistance,
    salience: salience?.salience,
    salienceSide: salience?.side,
    anchorRatio: salience?.anchorRatio,
    contentTop,
    contentBottom,
    visibleTop,
    visibleBottom,
    annotationId: annotation?.id || synthetic?.annotationId,
    targetNodeId: annotation?.targetNodeId || synthetic?.targetNodeId,
  };
}

function getElementTopInSection(element: HTMLElement, section: HTMLElement) {
  return element.getBoundingClientRect().top - section.getBoundingClientRect().top;
}
