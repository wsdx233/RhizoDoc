type JsonErrorBody = {
  error?: string;
  detail?: string;
  message?: string;
};

export async function fetchJson<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  const data = (await response.json().catch(() => null)) as (JsonErrorBody & T) | null;
  if (!response.ok) {
    const message = data?.error || data?.detail || data?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function postJson<T = any>(url: string, payload: unknown, options: RequestInit = {}): Promise<T> {
  return fetchJson<T>(url, {
    ...options,
    method: options.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: JSON.stringify(payload),
  });
}

export async function postEventStream<T = any>(
  url: string,
  payload: unknown,
  onEvent: (event: T) => void | Promise<void>,
  options: RequestInit = {},
): Promise<void> {
  const response = await fetch(url, {
    ...options,
    method: options.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      ...(options.headers || {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as JsonErrorBody | null;
    const message = data?.error || data?.detail || data?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  if (!response.body) throw new Error('浏览器不支持流式响应读取。');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = await consumeEventBlocks(buffer, onEvent);
  }

  buffer += decoder.decode();
  await consumeEventBlocks(`${buffer}\n\n`, onEvent);
}

async function consumeEventBlocks<T>(buffer: string, onEvent: (event: T) => void | Promise<void>): Promise<string> {
  let cursor = 0;
  while (true) {
    const end = buffer.indexOf('\n\n', cursor);
    if (end < 0) break;
    const block = buffer.slice(cursor, end);
    cursor = end + 2;
    const event = parseSseBlock<T>(block);
    if (event) await onEvent(event);
  }
  return buffer.slice(cursor);
}

function parseSseBlock<T>(block: string): T | null {
  let eventType = 'message';
  const dataLines: string[] = [];

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventType = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }

  if (dataLines.length === 0) return null;
  const data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
  return { type: eventType, ...data } as T;
}
