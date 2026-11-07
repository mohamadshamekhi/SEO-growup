"use client";
// Ported from public/app.js's api() — same X-Hub header (CSRF-lite), same JSON body
// encoding, same "throw with the server's Persian error message" contract, so UI error
// handling stays a simple try/catch with err.message everywhere, like the original.
export class ApiError extends Error {}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", "X-Hub": "1" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || res.statusText);
  return data as T;
}
