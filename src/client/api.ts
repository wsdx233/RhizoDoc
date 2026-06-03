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
