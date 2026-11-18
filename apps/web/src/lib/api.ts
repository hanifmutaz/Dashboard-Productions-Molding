import type { ApiError } from '@mpd/contracts';

let csrfToken: string | null = null;
export const setCsrf = (t: string | null) => { csrfToken = t; };

export class ApiFailure extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly requestId?: string) {
    super(message);
  }
}

/** Token CSRF basi (sesi diganti di tab lain, login ulang, restart): ambil token terbaru dari /api/auth/me. */
async function refreshCsrf(): Promise<boolean> {
  try {
    const res = await fetch(new URL('/api/auth/me', globalThis.location.href).href, { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return false;
    const me = (await res.json()) as { kind?: string; csrfToken?: string };
    if (me.kind !== 'user' || !me.csrfToken) return false;
    csrfToken = me.csrfToken;
    return true;
  } catch {
    return false;
  }
}

async function call<T>(method: string, url: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiFailure(0, 'NETWORK', 'Tidak dapat terhubung ke server. Periksa jaringan.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiFailure(res.status, 'BAD_RESPONSE', 'Respons server tidak valid.');
  }
  if (!res.ok) {
    const e = (json as ApiError | null)?.error;
    if (res.status === 403 && e?.code === 'CSRF' && !retried && method !== 'GET' && (await refreshCsrf())) return call<T>(method, url, body, true);
    throw new ApiFailure(res.status, e?.code ?? 'HTTP_' + res.status, e?.message ?? 'Permintaan gagal.', e?.requestId);
  }
  return json as T;
}

export const api = {
  get: <T>(url: string) => call<T>('GET', url),
  post: <T>(url: string, body?: unknown) => call<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => call<T>('PUT', url, body),
  del: <T>(url: string) => call<T>('DELETE', url),
};
export const qs = (o: Record<string, string | undefined | null>) =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();
