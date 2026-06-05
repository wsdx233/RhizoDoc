import { describe, expect, it } from 'vitest';
import { computeAnnotationSalience } from './annotation-salience.js';

describe('computeAnnotationSalience', () => {
  it('assigns the highest salience to annotations near the reading center', () => {
    const center = computeAnnotationSalience({ annotationTop: 45, annotationBottom: 55, visibleTop: 0, visibleBottom: 100 });
    const edge = computeAnnotationSalience({ annotationTop: 5, annotationBottom: 15, visibleTop: 0, visibleBottom: 100 });

    expect(center.side).toBe('visible');
    expect(center.salience).toBeGreaterThan(edge.salience);
    expect(center.anchorRatio).toBeCloseTo(0.5);
  });

  it('decays continuously across viewport boundaries', () => {
    const edgeVisible = computeAnnotationSalience({ annotationTop: 95, annotationBottom: 105, visibleTop: 0, visibleBottom: 100 });
    const nearBelow = computeAnnotationSalience({ annotationTop: 105, annotationBottom: 115, visibleTop: 0, visibleBottom: 100 });
    const farBelow = computeAnnotationSalience({ annotationTop: 250, annotationBottom: 260, visibleTop: 0, visibleBottom: 100 });

    expect(edgeVisible.side).toBe('visible');
    expect(nearBelow.side).toBe('below');
    expect(nearBelow.salience).toBeLessThan(edgeVisible.salience);
    expect(nearBelow.salience).toBeGreaterThan(farBelow.salience);
  });

  it('reports side and offscreen distance', () => {
    const above = computeAnnotationSalience({ annotationTop: -40, annotationBottom: -20, visibleTop: 0, visibleBottom: 100 });
    const below = computeAnnotationSalience({ annotationTop: 140, annotationBottom: 160, visibleTop: 0, visibleBottom: 100 });

    expect(above.side).toBe('above');
    expect(above.offscreenDistance).toBe(20);
    expect(below.side).toBe('below');
    expect(below.offscreenDistance).toBe(40);
  });

  it('lets selected annotations override salience decay', () => {
    const far = computeAnnotationSalience({ annotationTop: 500, annotationBottom: 510, visibleTop: 0, visibleBottom: 100 });
    const selected = computeAnnotationSalience({ annotationTop: 500, annotationBottom: 510, visibleTop: 0, visibleBottom: 100, selected: true });

    expect(far.salience).toBeLessThan(0.001);
    expect(selected.salience).toBe(1);
  });
});
