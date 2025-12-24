const $ = (id) => document.getElementById(id);
const logEl = $("log");

let ws = null;
let me = null;

function addLine(type, html, meta = "") {
  const div = document.createElement("div");
  div.className = "msg " + (type === "system" ? "system" : "");
  const metaDiv = document.createElement("div");
  metaDiv.className = "meta";
  metaDiv.textContent = meta;
  const contentDiv = document.createElement("div");
  contentDiv.className = "content";
  if (typeof html === "string") contentDiv.innerHTML = html;
  else contentDiv.appendChild(html);
  div.appendChild(metaDiv);
  div.appendChild(contentDiv);
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}

async function refreshMe() {
  try {
    const data = await api("/api/me", { method: "GET", headers: {} });
    me = data.user;
    $("meHint").textContent = `已登录：${me.username} (#${me.id})`;
    $("btnLogout").style.display = "";
  } catch {
    me = null;
    $("meHint").textContent = "未登录";
    $("btnLogout").style.display = "none";
  }
  updateButtons();
}

function updateButtons() {
  $("btnSend").disabled = !ws;
  $("btnDisconnect").disabled = !ws;
  $("btnConnect").disabled = !!ws;
}

$("btnRegister").onclick = async () => {
  const username = $("username").value.trim();
  const password = $("password").value;
  try {
    await api("/api/register", { method: "POST", body: JSON.stringify({ username, password }) });
    addLine("system", "注册成功，请登录。", new Date().toLocaleTimeString());
  } catch (e) {
    addLine("system", "注册失败：" + escapeHtml(e.message), new Date().toLocaleTimeString());
  }
};

$("btnLogin").onclick = async () => {
  const username = $("username").value.trim();
  const password = $("password").value;
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
    await refreshMe();
    addLine("system", "登录成功。", new Date().toLocaleTimeString());
  } catch (e) {
    addLine("system", "登录失败：" + escapeHtml(e.message), new Date().toLocaleTimeString());
  }
};

$("btnLogout").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
  } finally {
    await refreshMe();
    disconnect();
  }
};

$("btnConnect").onclick = async () => {
  if (!me) {
    addLine("system", "请先登录。", new Date().toLocaleTimeString());
    return;
  }
  const room = $("room").value.trim() || "global";
  logEl.innerHTML = "";

  // load history
  try {
    const hist = await api(`/api/history?room=${encodeURIComponent(room)}&limit=50`, { method: "GET", headers: {} });
    for (const m of hist.items) renderMessage(m);
  } catch (e) {
    addLine("system", "拉取历史失败：" + escapeHtml(e.message), new Date().toLocaleTimeString());
  }

  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(room)}`);

  ws.onopen = () => {
    addLine("system", `已连接到房间：${escapeHtml(room)}`, new Date().toLocaleTimeString());
    updateButtons();
  };
  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data.type === "system") {
        addLine("system", escapeHtml(data.text), new Date(data.ts).toLocaleTimeString());
      } else if (data.type === "message") {
        renderMessage(data);
      }
    } catch {}
  };
  ws.onclose = () => {
    addLine("system", "连接已关闭", new Date().toLocaleTimeString());
    ws = null;
    updateButtons();
  };
  ws.onerror = () => {};
};

$("btnDisconnect").onclick = () => disconnect();

function disconnect() {
  if (ws) ws.close();
  ws = null;
  updateButtons();
}

function renderMessage(m) {
  const t = new Date(m.ts).toLocaleTimeString();
  const meta = `${m.user.username}  ·  ${t}`;
  if (m.msgType === "text") {
    addLine("msg", escapeHtml(m.content), meta);
  } else if (m.msgType === "image") {
    const img = document.createElement("img");
    img.src = m.content;
    addLine("msg", img, meta);
  } else if (m.msgType === "video") {
    const v = document.createElement("video");
    v.src = m.content;
    v.controls = true;
    addLine("msg", v, meta);
  }
}

$("btnSend").onclick = async () => {
  if (!ws) return;
  const room = $("room").value.trim() || "global";
  const text = $("text").value;

  const file = $("file").files?.[0];
  try {
    if (file) {
      // init upload
      const init = await api("/api/media/init", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream", room })
      });

      // raw PUT to upload endpoint (streams)
      const putRes = await fetch(init.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      const putJson = await putRes.json().catch(() => ({}));
      if (!putRes.ok || putJson.ok === false) throw new Error(putJson.error || ("上传失败 HTTP " + putRes.status));

      const url = putJson.url;
      const msgType = (file.type || "").startsWith("video/") ? "video" : "image";
      ws.send(JSON.stringify({ type: msgType, url }));
      $("file").value = "";
      $("text").value = "";
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;
    ws.send(JSON.stringify({ type: "text", text: trimmed }));
    $("text").value = "";
  } catch (e) {
    addLine("system", "发送失败：" + escapeHtml(e.message), new Date().toLocaleTimeString());
  }
};

refreshMe();
