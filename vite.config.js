import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiTarget = process.env.RHIZODOC_API_TARGET || resolveApiTarget();

export default defineConfig({
  root: '.',
  publicDir: 'public-static',
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});

function resolveApiTarget() {
  const configPath = path.join(__dirname, 'rhizodoc.config.json');
  const config = readJson(configPath);
  const server = config?.server || {};
  const host = normalizeProxyHost(server.host || '127.0.0.1');
  const port = normalizePort(server.port, 3000);
  return `http://${host}:${port}`;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeProxyHost(host) {
  const normalized = String(host || '').trim();
  if (!normalized || normalized === '0.0.0.0' || normalized === '::') return '127.0.0.1';
  return normalized;
}

function normalizePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}
