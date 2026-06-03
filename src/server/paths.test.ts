import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathInsideRoot, resolvePathInsideRoot } from './paths.js';

describe('path safety helpers', () => {
  it('allows paths inside the configured root', () => {
    const root = path.resolve('/tmp/rhizodoc-flows');
    const file = resolvePathInsideRoot(root, 'demo.json');
    expect(file).toBe(path.join(root, 'demo.json'));
    expect(isPathInsideRoot(root, file)).toBe(true);
  });

  it('rejects parent directory traversal', () => {
    const root = path.resolve('/tmp/rhizodoc-flows');
    expect(() => resolvePathInsideRoot(root, '../secrets.json')).toThrow(/路径超出允许目录/);
  });

  it('does not treat sibling paths with the same prefix as children', () => {
    const root = path.resolve('/tmp/rhizodoc-flows');
    const sibling = path.resolve('/tmp/rhizodoc-flows-evil/demo.json');
    expect(isPathInsideRoot(root, sibling)).toBe(false);
  });
});
