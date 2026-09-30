import type { PublicState, SessionCredentials } from '../shared/types';
export type ActionResult = 'committed' | 'refresh' | 'retry';
export function makeRequestId(): string {
  // getRandomValues also works on HTTP LAN origins, unlike crypto.randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  credentials?: SessionCredentials,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(credentials ? { Authorization: `Bearer ${credentials.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error ?? '连接中断，请重试。', response.status);
  return data as T;
}
export async function subscribe(
  credentials: SessionCredentials,
  signal: AbortSignal,
  update: (state: PublicState) => void,
  connected: (value: boolean) => void,
): Promise<void> {
  while (!signal.aborted) {
    try {
      const response = await fetch(`/api/rooms/${credentials.room}/events`, {
        headers: { Authorization: `Bearer ${credentials.token}` },
        signal,
      });
      if (!response.ok || !response.body) throw new Error('stream failed');
      connected(true);
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index: number;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const message = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            if (message.startsWith('data: ')) update(JSON.parse(message.slice(6)) as PublicState);
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch {
      /* reconnect using a fresh authoritative snapshot */
    }
    connected(false);
    if (!signal.aborted)
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, 2500);
        signal.addEventListener('abort', onAbort, { once: true });
      });
  }
}
