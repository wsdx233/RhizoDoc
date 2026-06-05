export type AnnotationSalienceSide = 'visible' | 'above' | 'below';

export type AnnotationSalienceInput = {
  annotationTop: number;
  annotationBottom: number;
  visibleTop: number;
  visibleBottom: number;
  selected?: boolean;
};

export type AnnotationSalience = {
  salience: number;
  side: AnnotationSalienceSide;
  anchorRatio: number;
  distanceToCenter: number;
  offscreenDistance: number;
};

const MIN_VISIBLE_HEIGHT = 1;
const SALIENCE_RADIUS_MULTIPLIER = 0.72;

export function computeAnnotationSalience(input: AnnotationSalienceInput): AnnotationSalience {
  const visibleTop = finiteNumber(input.visibleTop, 0);
  const visibleBottom = Math.max(visibleTop + MIN_VISIBLE_HEIGHT, finiteNumber(input.visibleBottom, visibleTop + MIN_VISIBLE_HEIGHT));
  const annotationTop = finiteNumber(input.annotationTop, visibleTop);
  const annotationBottom = Math.max(annotationTop, finiteNumber(input.annotationBottom, annotationTop));
  const visibleHeight = visibleBottom - visibleTop;
  const visibleCenter = (visibleTop + visibleBottom) / 2;
  const annotationCenter = (annotationTop + annotationBottom) / 2;
  const distanceToCenter = Math.abs(annotationCenter - visibleCenter);
  const radius = Math.max(MIN_VISIBLE_HEIGHT, visibleHeight * SALIENCE_RADIUS_MULTIPLIER);
  const side = getSide(annotationTop, annotationBottom, visibleTop, visibleBottom);
  const offscreenDistance = getOffscreenDistance(side, annotationTop, annotationBottom, visibleTop, visibleBottom);
  const rawSalience = input.selected ? 1 : Math.exp(-((distanceToCenter / radius) ** 2));

  return {
    salience: clamp01(rawSalience),
    side,
    anchorRatio: clamp01((annotationCenter - visibleTop) / visibleHeight),
    distanceToCenter,
    offscreenDistance,
  };
}

function getSide(annotationTop: number, annotationBottom: number, visibleTop: number, visibleBottom: number): AnnotationSalienceSide {
  if (annotationBottom < visibleTop) return 'above';
  if (annotationTop > visibleBottom) return 'below';
  return 'visible';
}

function getOffscreenDistance(
  side: AnnotationSalienceSide,
  annotationTop: number,
  annotationBottom: number,
  visibleTop: number,
  visibleBottom: number,
) {
  if (side === 'above') return Math.max(0, visibleTop - annotationBottom);
  if (side === 'below') return Math.max(0, annotationTop - visibleBottom);
  return 0;
}

function finiteNumber(value: unknown, fallback: number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}
