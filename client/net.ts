import type { MoveMessage, PlayerState, ProjectileState, ServerMessage } from "../shared/protocol.ts";

export interface NetHandlers {
  onWelcome: (you: PlayerState, players: PlayerState[]) => void;
  onState: (players: PlayerState[], projectiles: ProjectileState[]) => void;
}

export interface Net {
  sendMove: (m: Omit<MoveMessage, "type">) => void;
  shoot: () => void;
}

export function connect(handlers: NetHandlers): Net {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${location.host}/ws`);

  socket.addEventListener("message", (event) => {
    const msg: ServerMessage = JSON.parse(event.data);
    if (msg.type === "welcome") handlers.onWelcome(msg.you, msg.players);
    else if (msg.type === "state") handlers.onState(msg.players, msg.projectiles);
  });

  const send = (payload: unknown): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  let queuedMove: Omit<MoveMessage, "type"> | undefined;
  socket.addEventListener("open", () => {
    if (queuedMove) send({ type: "move", ...queuedMove });
  });

  return {
    sendMove(m) {
      if (socket.readyState === WebSocket.OPEN) send({ type: "move", ...m });
      else queuedMove = m;
    },
    shoot() {
      send({ type: "shoot" });
    },
  };
}
