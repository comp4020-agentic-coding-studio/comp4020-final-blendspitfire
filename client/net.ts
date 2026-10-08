import type { MoveMessage, PlayerState, ProjectileState, ServerMessage } from "../shared/protocol.ts";

export interface NetHandlers {
  onWelcome: (you: PlayerState, players: PlayerState[]) => void;
  onState: (players: PlayerState[], projectiles: ProjectileState[]) => void;
  /** fires on every connect/disconnect transition, including the first connect */
  onConnectionChange: (connected: boolean) => void;
}

export interface Net {
  sendMove: (m: Omit<MoveMessage, "type">) => void;
  shoot: () => void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;

export function connect(handlers: NetHandlers): Net {
  let socket: WebSocket | undefined;
  let queuedMove: Omit<MoveMessage, "type"> | undefined;
  let attempt = 0;
  let closedByUs = false;

  const send = (payload: unknown): void => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  function open(): void {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    socket = ws;

    ws.addEventListener("open", () => {
      attempt = 0;
      handlers.onConnectionChange(true);
      if (queuedMove) send({ type: "move", ...queuedMove });
    });

    ws.addEventListener("message", (event) => {
      const msg: ServerMessage = JSON.parse(event.data);
      if (msg.type === "welcome") handlers.onWelcome(msg.you, msg.players);
      else if (msg.type === "state") handlers.onState(msg.players, msg.projectiles);
    });

    // A Fly machine that scales to zero, a wifi blip, a laptop sleeping ---
    // any of these drop the socket. Without a reconnect loop that's
    // permanent until the tab is reloaded, so always retry unless the page
    // itself is going away.
    ws.addEventListener("close", () => {
      handlers.onConnectionChange(false);
      if (closedByUs) return;
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
      attempt += 1;
      setTimeout(open, delay);
    });
    ws.addEventListener("error", () => ws.close());
  }

  open();
  window.addEventListener("beforeunload", () => {
    closedByUs = true;
  });

  return {
    sendMove(m) {
      if (socket?.readyState === WebSocket.OPEN) send({ type: "move", ...m });
      else queuedMove = m;
    },
    shoot() {
      send({ type: "shoot" });
    },
  };
}
