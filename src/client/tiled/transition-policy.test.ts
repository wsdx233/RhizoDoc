import { describe, expect, it } from 'vitest';
import { resolveTiledLayoutTransaction } from './transition-policy.js';

describe('resolveTiledLayoutTransaction', () => {
  it('animates vertical keyboard focus changes instead of stabilizing the newly focused panel', () => {
    const transaction = resolveTiledLayoutTransaction({ reason: 'focus-keyboard-vertical' });

    expect(transaction.sectionMotion).toBe('semantic');
    expect(transaction.focusedMotion).toBe('animate');
    expect(transaction.relationMotion).toBe('track-transition');
  });

  it('keeps content-driven semantic refreshes stable because focus does not change', () => {
    const transaction = resolveTiledLayoutTransaction({ reason: 'content-scroll' });

    expect(transaction.sectionMotion).toBe('semantic');
    expect(transaction.focusedMotion).toBe('stable');
    expect(transaction.viewportLock).toBe('focused-section-top');
  });
});
