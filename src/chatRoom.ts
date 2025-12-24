import type { Env } from "./types";
import { authUser } from "./auth";
import { json } from "./utils";

type ClientMsg =
  | { type: "text"; text: string }
  | { type: "image" | "video"; url: string };

type ServerMsg =
  | { type: "system"; text: string; ts: number }
  | { type: "message"; id: string; room: string; user: { id: number; username: string }; msgType: "text" | "image" | "video"; content: string; ts: number };

export class ChatRoom {
  private state: DurableObjectState;
  private env: Env;
  private sockets = new Map<WebSocket, { id: number; username: string }>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const room = url.searchParams.get("room") || "global";

    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") return json({ ok: false, error: "Expected websocket" }, { status: 426 });

    const user = await authUser(request, this.env);
    if (!user) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Attach handlers before accepting.
    this.acceptSocket(server, room, user);

    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptSocket(ws: WebSocket, room: string, user: { id: number; username: string }) {
    ws.accept();
    this.sockets.set(ws, user);

    ws.addEventListener("message", (evt) => {
      this.onMessage(ws, room, evt.data).catch(() => {
        // ignore
      });
    });
    ws.addEventListener("close", () => this.onClose(ws, room));
    ws.addEventListener("error", () => this.onClose(ws, room));

    ws.send(JSON.stringify({ type: "system", text: `欢迎，${user.username}！`, ts: Date.now() } satisfies ServerMsg));

    this.broadcast({ type: "system", text: `${user.username} 进入了房间`, ts: Date.now() }, ws);
  }

  private onClose(ws: WebSocket, room: string) {
    const u = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (u) this.broadcast({ type: "system", text: `${u.username} 离开了房间`, ts: Date.now() }, ws);
  }

  private async onMessage(ws: WebSocket, room: string, data: any) {
    const u = this.sockets.get(ws);
    if (!u) return;

    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    } catch {
      return;
    }

    // Basic validation
    if (msg.type === "text") {
      const text = (msg.text || "").trim();
      if (!text) return;
      if (text.length > 2000) return;
      await this.persistAndBroadcast(room, u, "text", text);
    } else if (msg.type === "image" || msg.type === "video") {
      const url = (msg.url || "").trim();
      if (!url.startsWith("/media/")) return; // only allow our own media route
      await this.persistAndBroadcast(room, u, msg.type, url);
    }
  }

  private async persistAndBroadcast(room: string, user: { id: number; username: string }, msgType: "text" | "image" | "video", content: string) {
    const id = crypto.randomUUID();
    const ts = Date.now();
    const createdAt = Math.floor(ts / 1000);

    await this.env.DB.prepare(
      "INSERT INTO messages (id, room, user_id, type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, room, user.id, msgType, content, createdAt).run();

    this.broadcast({
      type: "message",
      id,
      room,
      user: { id: user.id, username: user.username },
      msgType,
      content,
      ts
    });
  }

  private broadcast(msg: ServerMsg, exclude?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const [ws] of this.sockets) {
      if (exclude && ws === exclude) continue;
      try { ws.send(data); } catch { /* ignore */ }
    }
  }
}
