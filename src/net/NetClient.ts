import type { ClientMsg, ServerMsg } from "@/net/protocol";

type Handler = (msg: ServerMsg) => void;

/**
 * Thin WebSocket client for the private-room multiplayer server. Connects to
 * `/mp` on the same origin (ws:// or wss:// to match the page), auto-measures
 * ping, and fans server messages out to subscribers. All gameplay authority
 * lives on the server; this is transport + a tiny event bus.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  playerId = "";
  ping = 0;
  connected = false;

  onOpen?: () => void;
  onClose?: () => void;

  connect(hello: { token?: string; name: string; rankInsignia: string; rankName: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}/mp`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      const failTimer = setTimeout(() => reject(new Error("Connection timed out.")), 8000);
      ws.onopen = () => {
        clearTimeout(failTimer);
        this.connected = true;
        this.send({ t: "hello", ...hello });
        this.pingTimer = setInterval(() => this.send({ t: "ping", ts: performance.now() }), 2000);
        this.onOpen?.();
        resolve();
      };
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(ev.data as string) as ServerMsg;
        } catch {
          return;
        }
        if (msg.t === "welcome") this.playerId = msg.playerId;
        else if (msg.t === "pong") { this.ping = Math.round(performance.now() - msg.ts); return; }
        for (const h of this.handlers) h(msg);
      };
      ws.onclose = () => {
        clearTimeout(failTimer);
        this.connected = false;
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.onClose?.();
      };
      ws.onerror = () => {
        clearTimeout(failTimer);
        reject(new Error("Could not reach the multiplayer server."));
      };
    });
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  disconnect(): void {
    this.handlers.clear();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
