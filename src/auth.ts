import type { Env, JwtUser } from "./types";
import { b64urlDecodeToBytes, b64urlEncode, hmacSha256, timingSafeEqual } from "./utils";

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function hashPassword(password: string, saltB64: string | null = null) {
  const salt = saltB64 ? b64urlDecodeToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 120_000, hash: "SHA-256" },
    key,
    256
  );
  const hash = new Uint8Array(bits);
  return { salt: b64urlEncode(salt), hash: b64urlEncode(hash) };
}

export async function verifyPassword(password: string, salt: string, hash: string) {
  const { hash: computed } = await hashPassword(password, salt);
  return timingSafeEqual(computed, hash);
}

type JwtPayload = JwtUser & { iat: number; exp: number };

export async function signJwt(user: JwtUser, env: Env, ttlSec = 7 * 24 * 3600) {
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = { ...user, iat: now, exp: now + ttlSec };
  const payloadB64 = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${header}.${payloadB64}`;
  const sig = await hmacSha256(env.JWT_SECRET, signingInput);
  return `${signingInput}.${b64urlEncode(sig)}`;
}

export async function verifyJwt(token: string, env: Env): Promise<JwtUser | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const signingInput = `${h}.${p}`;
  const sig = await hmacSha256(env.JWT_SECRET, signingInput);
  const expected = b64urlEncode(sig);
  if (!timingSafeEqual(expected, s)) return null;

  try {
    const payloadJson = dec.decode(b64urlDecodeToBytes(p));
    const payload = JSON.parse(payloadJson) as JwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    if (typeof payload.id !== "number" || typeof payload.username !== "string") return null;
    return { id: payload.id, username: payload.username };
  } catch {
    return null;
  }
}

export async function authUser(req: Request, env: Env): Promise<JwtUser | null> {
  const cookie = req.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  const token = m ? decodeURIComponent(m[1]) : null;
  if (!token) return null;
  return verifyJwt(token, env);
}
