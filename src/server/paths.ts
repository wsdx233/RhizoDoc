import path from 'node:path';

/**
 * Returns true only when candidatePath is inside rootPath (or exactly rootPath).
 * Uses path.relative instead of string prefix checks so sibling directories such as
 * /tmp/flows-evil are not treated as children of /tmp/flows.
 */
export function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolvePathInsideRoot(rootPath: string, childPath: string): string {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(root, childPath);
  if (!isPathInsideRoot(root, candidate)) {
    throw new Error('路径超出允许目录');
  }
  return candidate;
}
