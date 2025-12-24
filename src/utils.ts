export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function bad(status: number, message: string) {
  return json({ ok: false, error: message }, { status });
}

export function ok(data: unknown = { ok: true }, init: ResponseInit = {}) {
  return json({ ok: true, ...data }, init);
}

export function getCookie(req: Request, name: string): string | null {
  const h = req.headers.get("Cookie");
  if (!h) return null;
  const parts = h.split(/;\s*/);
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx);
    if (k === name) return decodeURIComponent(p.slice(idx + 1));
  }
  return null;
}

export function setCookie(name: string, value: string, opts: {
  maxAgeSec?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
} = {}) {
  const {
    maxAgeSec = 7 * 24 * 3600,
    httpOnly = true,
    secure = true,
    sameSite = "Lax",
    path = "/",
  } = opts;

  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `Max-Age=${maxAgeSec}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name: string) {
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure`;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  const b64 = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return b64;
}

export function b64urlDecodeToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hmacSha256(key: string, data: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return new Uint8Array(sig);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
