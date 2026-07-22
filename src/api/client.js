// Single entry point for every call to the corelyn-studiod sidecar.
//
// The daemon binds an ephemeral port; electron/preload.cjs passes it to the
// renderer as window.corelyn.apiPort. A plain-browser `npm run dev` has no
// preload, so it falls back to the daemon's default port — start the daemon by
// hand for that case.

const port = typeof window !== "undefined" ? window.corelyn?.apiPort : null;

export const BASE_URL = port ? `http://127.0.0.1:${port}` : "http://localhost:8000";
const WS_URL = BASE_URL.replace(/^http/, "ws");

// Non-2xx responses carry {"detail": "..."} and the UI shows it verbatim
// (spec §4.2), so unwrap it here rather than at every call site.
async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText || "Request failed");
  }
  return res.json();
}

export async function health() {
  const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
  const data = await res.json();
  return data.status === "ok";
}

export const deploy = (spec) => post("/api/deploy", spec);

export const cancel = () => post("/api/deploy", { mission_id: "__cancel__", command: "cancel" });

// Subscribes to mission status. Frames missing either field are dropped;
// the socket reconnects 3s after any close, indefinitely (spec §4.3).
// Returns a teardown that stops reconnecting and closes the socket.
export function connectStatus(onMessage) {
  let ws = null;
  let timer = null;
  let stopped = false;

  const connect = () => {
    if (stopped) return;
    try {
      ws = new WebSocket(`${WS_URL}/ws/mission/status`);
    } catch (err) {
      console.warn("Mission status WebSocket disabled:", err);
      return;
    }
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.node_id && data.status) onMessage(data);
      } catch {
        // malformed frame — ignore
      }
    };
    ws.onclose = () => { if (!stopped) timer = setTimeout(connect, 3000); };
    ws.onerror = () => ws?.close();
  };

  connect();
  return () => { stopped = true; clearTimeout(timer); ws?.close(); };
}
