import { WebSocketServer } from 'ws';
import { bindWebSocketController } from '../controllers/websocketController.js';

export function attachWebSocket(server, hub) {
  // Reuse the HTTP server's port and accept WebSocket upgrades at /ws.
  // maxPayload limits the size of an incoming WebSocket message in bytes.
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });
  bindWebSocketController(wss, hub);
  return wss;
}
