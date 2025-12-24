import type { Env } from "./types";
import { ChatRoom } from "./chatRoom";
import { authUser, signJwt, verifyPassword, hashPassword } from "./auth";
import { bad, ok, json, setCookie, clearCookie } from "./utils";

export { ChatRoom };

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

function notFound() {
  return json({ ok: false, error: "Not Found" }, { status: 404 });
}

function methodNotAllowed() {
  return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // API routes
    if (pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    // WebSocket route (forward to Durable Object)
    if (pathname === "/ws") {
      const room = url.searchParams.get("room") || "global";
      const id = env.ROOM.idFromName(room);
      const stub = env.ROOM.get(id);
      return stub.fetch(request);
    }

    // Media route
    if (pathname.startsWith("/media/")) {
      return handleMediaGet(request, env);
    }

    // Static assets
    return env.ASSETS.fetch(request);
  }
};

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname;

  // auth
  if (p === "/api/me" && request.method === "GET") {
    const user = await authUser(request, env);
    if (!user) return bad(401, "Unauthorized");
    return ok({ user });
  }

  if (p === "/api/register") {
    if (request.method !== "POST") return methodNotAllowed();
    if ((env.ALLOW_REGISTER || "false").toLowerCase() !== "true") return bad(403, "Registration disabled");

    const body = await readJson<{ username: string; password: string }>(request);
    if (!body) return bad(400, "Invalid JSON");
    const username = (body.username || "").trim();
    const password = body.password || "";
    if (!/^[a-zA-Z0-9_\-]{3,32}$/.test(username)) return bad(400, "username 只能是 3-32 位字母数字 _-");
    if (password.length < 8 || password.length > 128) return bad(400, "password 需要 8-128 位");

    // Ensure not exists
    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first<{ id: number }>();
    if (existing) return bad(409, "User already exists");

    const { salt, hash } = await hashPassword(password);
    const createdAt = Math.floor(Date.now() / 1000);
    await env.DB.prepare("INSERT INTO users (username, pw_salt, pw_hash, created_at) VALUES (?, ?, ?, ?)").bind(username, salt, hash, createdAt).run();

    return ok({ message: "registered" });
  }

  if (p === "/api/login") {
    if (request.method !== "POST") return methodNotAllowed();
    const body = await readJson<{ username: string; password: string }>(request);
    if (!body) return bad(400, "Invalid JSON");
    const username = (body.username || "").trim();
    const password = body.password || "";

    const userRow = await env.DB.prepare("SELECT id, username, pw_salt, pw_hash FROM users WHERE username = ?")
      .bind(username).first<{ id: number; username: string; pw_salt: string; pw_hash: string }>();

    if (!userRow) return bad(401, "Invalid credentials");

    const passOk = await verifyPassword(password, userRow.pw_salt, userRow.pw_hash);
    if (!passOk) return bad(401, "Invalid credentials");

    const token = await signJwt({ id: userRow.id, username: userRow.username }, env);
    const headers = new Headers();
    headers.append("Set-Cookie", setCookie("session", token));
    return ok({ user: { id: userRow.id, username: userRow.username } }, { headers });
  }

  if (p === "/api/logout") {
    if (request.method !== "POST") return methodNotAllowed();
    const headers = new Headers();
    headers.append("Set-Cookie", clearCookie("session"));
    return ok({ message: "logged out" }, { headers });
  }

  // history: GET /api/history?room=global&limit=50
  if (p === "/api/history" && request.method === "GET") {
    const user = await authUser(request, env);
    if (!user) return bad(401, "Unauthorized");

    const room = url.searchParams.get("room") || "global";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

    const res = await env.DB.prepare(
      `SELECT m.id, m.room, m.type, m.content, m.created_at, u.id as user_id, u.username
       FROM messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.room = ?
       ORDER BY m.created_at DESC
       LIMIT ?`
    ).bind(room, limit).all<{
      id: string; room: string; type: string; content: string; created_at: number; user_id: number; username: string
    }>();

    const items = (res.results || []).reverse().map(r => ({
      id: r.id,
      room: r.room,
      msgType: r.type,
      content: r.content,
      ts: r.created_at * 1000,
      user: { id: r.user_id, username: r.username }
    }));

    return ok({ room, items });
  }

  // media init: POST /api/media/init
  if (p === "/api/media/init" && request.method === "POST") {
    const user = await authUser(request, env);
    if (!user) return bad(401, "Unauthorized");

    const body = await readJson<{ filename: string; contentType: string; room?: string }>(request);
    if (!body) return bad(400, "Invalid JSON");

    const room = (body.room || "global").slice(0, 64);
    const contentType = (body.contentType || "application/octet-stream").slice(0, 128);

    const ext = guessExt(body.filename || "", contentType);
    const key = `${room}/${user.id}/${Date.now()}-${crypto.randomUUID()}${ext}`;

    return ok({
      key,
      uploadUrl: `/api/media/upload/${encodeURIComponent(key)}`,
      mediaUrl: `/media/${encodeURIComponent(key)}`,
      contentType
    });
  }

  // media upload: PUT /api/media/upload/:key   (body = file bytes)
  if (p.startsWith("/api/media/upload/")) {
    if (request.method !== "PUT") return methodNotAllowed();
    const user = await authUser(request, env);
    if (!user) return bad(401, "Unauthorized");

    const key = decodeURIComponent(p.slice("/api/media/upload/".length));
    if (!key || key.includes("..")) return bad(400, "Bad key");

    const contentType = request.headers.get("Content-Type") || "application/octet-stream";
    if (!request.body) return bad(400, "Missing body");

    await env.MEDIA.put(key, request.body, {
      httpMetadata: { contentType },
      customMetadata: { uploadedBy: String(user.id) }
    });

    return ok({ url: `/media/${encodeURIComponent(key)}` });
  }

  return notFound();
}

async function handleMediaGet(request: Request, env: Env): Promise<Response> {
  // 这里选择“需要登录才能访问媒体”，浏览器同域 <img>/<video> 会自动带 cookie
  const user = await authUser(request, env);
  if (!user) return bad(401, "Unauthorized");

  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.slice("/media/".length));
  if (!key || key.includes("..")) return bad(400, "Bad key");

  const obj = await env.MEDIA.get(key);
  if (!obj) return bad(404, "Not found");

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  // Inline display
  headers.set("content-disposition", "inline");

  return new Response(obj.body, { headers });
}

function guessExt(filename: string, contentType: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  if (m) return "." + m[1];
  if (contentType.startsWith("image/")) return ".img";
  if (contentType.startsWith("video/")) return ".vid";
  return "";
}
