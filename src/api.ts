import type { PublicState } from '../shared/types';
export interface Access {
  id: string;
  token: string;
  name?: string;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, access?: Access, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(access ? { Authorization: `Bearer ${access.token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('连接暂时中断。可以重试原请求。');
  }
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error ?? '请求失败', response.status);
  return data;
}
export async function subscribe(
  access: Access,
  signal: AbortSignal,
  update: (state: PublicState) => void,
  connected: (yes: boolean) => void,
) {
  while (!signal.aborted) {
    try {
      const response = await fetch(`/api/rooms/${access.id}/events`, {
        headers: { Authorization: `Bearer ${access.token}` },
        signal,
      });
      if (!response.ok) throw new Error('stream');
      connected(true);
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        while (buffer.includes('\n\n')) {
          const end = buffer.indexOf('\n\n'),
            event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (event.startsWith('data: ')) update(JSON.parse(event.slice(6)));
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    connected(false);
    await new Promise<void>((r) => {
      const t = setTimeout(r, 2000);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          r();
        },
        { once: true },
      );
    });
  }
}
