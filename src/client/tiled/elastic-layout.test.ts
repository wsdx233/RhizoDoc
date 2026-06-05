import { describe, expect, it } from 'vitest';
import { fitElasticStack } from './elastic-layout.js';

describe('fitElasticStack', () => {
  it('keeps compact ordered panels when desired positions are compact', () => {
    const result = fitElasticStack([
      { id: 'a', height: 100, desiredY: 0, weight: 10 },
      { id: 'b', height: 80, desiredY: 112, weight: 10 },
      { id: 'c', height: 60, desiredY: 204, weight: 10 },
    ], { minGap: 12 });

    expect(result.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(result.map((item) => Math.round(item.y))).toEqual([0, 112, 204]);
    expect(result.map((item) => Math.round(item.gapBefore))).toEqual([0, 12, 12]);
  });

  it('creates automatic extra gaps when desired positions pull panels apart', () => {
    const result = fitElasticStack([
      { id: 'a', height: 100, desiredY: 0, weight: 20 },
      { id: 'b', height: 80, desiredY: 320, weight: 20 },
      { id: 'c', height: 60, desiredY: 412, weight: 20 },
    ], { minGap: 12 });

    expect(result[1].y).toBeCloseTo(320);
    expect(result[1].gapBefore).toBeCloseTo(220);
    expect(result[1].extraGapBefore).toBeCloseTo(208);
    expect(result[2].gapBefore).toBeCloseTo(12);
  });

  it('prevents overlaps when desired positions collide', () => {
    const result = fitElasticStack([
      { id: 'a', height: 100, desiredY: 0, weight: 10 },
      { id: 'b', height: 100, desiredY: 20, weight: 10 },
      { id: 'c', height: 100, desiredY: 40, weight: 10 },
    ], { minGap: 10 });

    expect(result[1].y - result[0].y).toBeGreaterThanOrEqual(110 - 1e-6);
    expect(result[2].y - result[1].y).toBeGreaterThanOrEqual(110 - 1e-6);
  });

  it('lets higher-weight items stay closer to their desired positions', () => {
    const result = fitElasticStack([
      { id: 'a', height: 100, desiredY: 0, weight: 1 },
      { id: 'b', height: 100, desiredY: 20, weight: 100 },
    ], { minGap: 10 });

    expect(Math.abs(result[1].y - 20)).toBeLessThan(Math.abs(result[0].y - 0));
    expect(result[1].y - result[0].y).toBeGreaterThanOrEqual(110 - 1e-6);
  });

  it('sanitizes non-finite and negative numeric inputs', () => {
    const result = fitElasticStack([
      { id: 'a', height: Number.POSITIVE_INFINITY, desiredY: Number.NaN, weight: Number.NEGATIVE_INFINITY },
      { id: 'b', height: -20, desiredY: Number.POSITIVE_INFINITY, weight: 0 },
      { id: 'c', height: 40, desiredY: 80, weight: Number.NaN },
    ], { minGap: Number.NEGATIVE_INFINITY });

    for (const item of result) {
      expect(Number.isFinite(item.y)).toBe(true);
      expect(Number.isFinite(item.height)).toBe(true);
      expect(Number.isFinite(item.gapBefore)).toBe(true);
      expect(Number.isFinite(item.extraGapBefore)).toBe(true);
    }
    expect(result.map((item) => item.height)).toEqual([0, 0, 40]);
    expect(result[1].y).toBeGreaterThanOrEqual(result[0].y + result[0].height);
    expect(result[2].y).toBeGreaterThanOrEqual(result[1].y + result[1].height);
  });
});
