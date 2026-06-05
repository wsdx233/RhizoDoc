import type { RhizoAnnotation, TiledPageLayout } from '../../shared/types.js';
import { clamp, cssAttr } from '../utils.js';

export type TiledAnchorKind = 'visible-content' | 'annotation-span' | 'visible-panel';
export type TiledAnchorVisibility = 'visible' | 'above-viewport' | 'below-viewport';

export type TiledLayoutAnchor = {
  nodeId: string;
  kind: TiledAnchorKind;
  top: number;
  bottom: number;
  center: number;
  visibility: TiledAnchorVisibility;
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
  annotations?: RhizoAnnotation[];
};

export function measureTiledAnchors(options: MeasureTiledAnchorsOptions): TiledAnchorRegistry | undefined {
  const registry: TiledAnchorRegistry = { focusNodeId: options.focusNodeId || undefined, nodeAnchors: {}, annotationAnchors: {} };
  const focusNodeId = options.focusNodeId || '';
  if (focusNodeId && options.focusedLayout) {
    const section = findTiledSection(options.root, focusNodeId);
    const anchor = section
      ? measureVisibleContentAnchor(options.root, section, options.focusedLayout.height)
        ?? measureVisiblePanelAnchor(options.root, section, options.focusedLayout.height)
      : undefined;
    if (anchor) registry.nodeAnchors[focusNodeId] = anchor;
  }

  for (const annotation of options.annotations || []) {
    const anchor = measureAnnotationAnchor(options.root, annotation);
    if (anchor) registry.annotationAnchors[annotation.id] = anchor;
  }

  return Object.keys(registry.nodeAnchors).length || Object.keys(registry.annotationAnchors).length ? registry : undefined;
}

function findTiledSection(root: HTMLElement, nodeId: string) {
  return root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`) as HTMLElement | null;
}

function measureVisibleContentAnchor(root: HTMLElement, section: HTMLElement, fallbackHeight: number): TiledLayoutAnchor | null {
  const content = section.querySelector('.tiled-content') as HTMLElement | null;
  if (!content) return null;
  const sectionRect = section.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const visibleTop = Math.max(contentRect.top, rootRect.top, sectionRect.top);
  const visibleBottom = Math.min(contentRect.bottom, rootRect.bottom, sectionRect.bottom);
  if (visibleBottom <= visibleTop + 1) return null;
  return createAnchorFromViewportInterval(section, 'visible-content', visibleTop, visibleBottom, fallbackHeight);
}

function measureVisiblePanelAnchor(root: HTMLElement, section: HTMLElement, fallbackHeight: number): TiledLayoutAnchor | null {
  const sectionRect = section.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const visibleTop = Math.max(sectionRect.top, rootRect.top);
  const visibleBottom = Math.min(sectionRect.bottom, rootRect.bottom);
  if (visibleBottom <= visibleTop + 1) return null;
  return createAnchorFromViewportInterval(section, 'visible-panel', visibleTop, visibleBottom, fallbackHeight);
}

function measureAnnotationAnchor(root: HTMLElement, annotation: RhizoAnnotation): TiledLayoutAnchor | null {
  if (!annotation.id || !annotation.sourceNodeId) return null;
  const section = findTiledSection(root, annotation.sourceNodeId);
  if (!section) return null;
  const element = section.querySelector(`[data-annotation-id="${cssAttr(annotation.id)}"]`) as HTMLElement | null;
  if (!element) return null;

  const sectionRect = section.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const content = element.closest('.tiled-content') as HTMLElement | null;
  const contentRect = content?.getBoundingClientRect();
  const clipTop = Math.max(rootRect.top, sectionRect.top, contentRect?.top ?? sectionRect.top);
  const clipBottom = Math.min(rootRect.bottom, sectionRect.bottom, contentRect?.bottom ?? sectionRect.bottom);
  if (clipBottom <= clipTop + 1) return null;

  const visibleTop = Math.max(elementRect.top, clipTop);
  const visibleBottom = Math.min(elementRect.bottom, clipBottom);
  if (visibleBottom > visibleTop + 1) {
    return createAnchorFromViewportInterval(section, 'annotation-span', visibleTop, visibleBottom, section.offsetHeight || 0, annotation, 'visible');
  }

  const elementCenter = elementRect.top + elementRect.height / 2;
  const visibility: TiledAnchorVisibility = elementRect.bottom < clipTop ? 'above-viewport' : 'below-viewport';
  const clampedCenter = visibility === 'above-viewport'
    ? clipTop
    : elementRect.top > clipBottom
      ? clipBottom
      : clamp(elementCenter, clipTop, clipBottom);
  return createAnchorFromViewportInterval(section, 'annotation-span', clampedCenter, clampedCenter, section.offsetHeight || 0, annotation, visibility);
}

function createAnchorFromViewportInterval(
  section: HTMLElement,
  kind: TiledAnchorKind,
  viewportTop: number,
  viewportBottom: number,
  fallbackHeight: number,
  annotation?: RhizoAnnotation,
  visibility: TiledAnchorVisibility = 'visible',
): TiledLayoutAnchor {
  const sectionRect = section.getBoundingClientRect();
  const height = section.offsetHeight || fallbackHeight || Math.max(1, sectionRect.height);
  const top = clamp(viewportTop - sectionRect.top, 0, height);
  const bottom = clamp(viewportBottom - sectionRect.top, 0, height);
  const center = clamp((top + bottom) / 2, 0, height);
  return {
    nodeId: annotation?.sourceNodeId || section.dataset.nodeId || '',
    kind,
    top,
    bottom,
    center,
    visibility,
    annotationId: annotation?.id,
    targetNodeId: annotation?.targetNodeId,
  };
}
