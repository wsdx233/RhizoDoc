import { afterEach, describe, expect, it } from 'vitest';
import { clearStreamingPreview, renderStreamingMarkdownPreview } from './streaming-preview.js';

const sessionKey = 'streaming-preview-test';

describe('streaming markdown preview', () => {
  afterEach(() => clearStreamingPreview(sessionKey));

  it('does not take over markdown without an active trailing code fence', async () => {
    await expect(renderStreamingMarkdownPreview(sessionKey, '## Title\n\n```ts\nconst done = true;\n```\n')).resolves.toBeNull();
  });

  it('renders an active code fence with streamed Shiki tokens', async () => {
    const html = await renderStreamingMarkdownPreview(sessionKey, 'Intro\n\n```ts\nconst value = "<safe>";');

    expect(html).toContain('shiki-stream');
    expect(html).toContain('language-typescript');
    expect(html).toContain('const');
    expect(html).toContain('&lt;safe&gt;');
    expect(html).not.toContain('```');
  });
});
