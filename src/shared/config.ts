import { z } from 'zod';
import type { RhizoDocConfig } from './types.js';

const defaultRhizoDocConfig: RhizoDocConfig = {
  server: {
    host: '127.0.0.1',
    port: 3000,
    jsonLimit: '20mb',
  },
  pi: {
    provider: '',
    model: '',
    thinkingLevel: '',
    maxTokens: 12000,
  },
  storage: {
    flowsDir: 'data/flows',
  },
};

export const rhizoDocConfigSchema = z
  .object({
    server: z
      .object({
        host: z.string().trim().min(1).default(defaultRhizoDocConfig.server.host),
        port: z.coerce.number().int().min(1).max(65535).default(defaultRhizoDocConfig.server.port),
        jsonLimit: z.string().min(1).default(defaultRhizoDocConfig.server.jsonLimit),
      })
      .default(defaultRhizoDocConfig.server),
    pi: z
      .object({
        provider: z.string().trim().default(defaultRhizoDocConfig.pi.provider),
        model: z.string().trim().default(defaultRhizoDocConfig.pi.model),
        thinkingLevel: z.string().trim().default(defaultRhizoDocConfig.pi.thinkingLevel),
        maxTokens: z.coerce.number().int().min(1).max(200000).default(defaultRhizoDocConfig.pi.maxTokens),
      })
      .default(defaultRhizoDocConfig.pi),
    storage: z
      .object({
        flowsDir: z.string().min(1).default(defaultRhizoDocConfig.storage.flowsDir),
      })
      .default(defaultRhizoDocConfig.storage),
  })
  .default(defaultRhizoDocConfig);

export function normalizeRhizoDocConfig(raw: unknown = {}): RhizoDocConfig {
  return rhizoDocConfigSchema.parse(raw ?? {}) as RhizoDocConfig;
}
