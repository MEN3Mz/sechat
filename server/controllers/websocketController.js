import { WebSocket } from 'ws';
import { BadRequest, Connection } from '../hub.js';

// Each socket gets its own authenticated connection state.
function websocketController(hub, send) {
  let conn;
  async function handleFrame(frame) {
    if (frame.type === 'join') {
      // Authenticate once. The Hub registers the connection and replays pending messages.
      if (conn) throw new BadRequest('already joined');
      const user = hub.authenticate(frame.user, frame.token);
      if (!user) throw new BadRequest('invalid username or token');
      conn = new Connection(user, 'ws', send);
      await hub.join(conn);
      return;
    }

    if (!conn) throw new BadRequest('join first');
    switch (frame.type) {
      case 'msg': {
        // Use the authenticated username as the sender. The Hub stores and routes the message.
        const msg = await hub.submit(conn.user, frame.to, frame.id, frame.body);
        // Tell the sender the Hub accepted the message.
        await send({ type: 'sent', id: msg.id, seq: msg.seq });
        break;
      }
      case 'ack':
        // The recipient confirms receipt so the Hub can stop replaying this message.
        if (typeof frame.id !== 'string' || !frame.id || frame.id.length > 64) {
        throw new BadRequest('bad message id');
        }
        await hub.acknowledge(conn.user, frame.id);
        break;
      default:
        throw new BadRequest('unknown frame type');
    }
  }

  function disconnect() {
    if (conn) hub.leave(conn);
  }

  return { handleFrame, disconnect };
}

const HEARTBEAT_MS = 30_000;

// The wire format uses a JSON text message with a type field.
function readFrame(data, isBinary) {
  if (isBinary) throw new BadRequest('expected a JSON text frame');
  let frame;
  try {
    frame = JSON.parse(data.toString());
  } catch {
    throw new BadRequest('invalid JSON');
  }
  if (!frame || typeof frame.type !== 'string') {
    throw new BadRequest('missing frame type');
  }
  return frame;
}

export function bindWebSocketController(wss, hub) {
  const awaitingPong = new Set();

  wss.on('connection', (socket) => {
    let pending = Promise.resolve();

    // Wrap the socket callback in a promise so the Hub can await sends and handle failures.
    const send = (frame) => new Promise((resolve, reject) => {
      const payload = JSON.stringify(frame);
      socket.send(payload, (err) => {
        if (err) return reject(err);
        hub.metrics.bytesOut += Buffer.byteLength(payload);
        resolve();
      });
    });

    const { handleFrame, disconnect } = websocketController(hub, send);

    socket.on('message', (data, isBinary) => {
      hub.metrics.bytesIn += data.length;
      // Queue frames per socket so a msg arriving after join waits for join to finish.
      pending = pending.then(async () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
          await handleFrame(readFrame(data, isBinary));
        } catch (err) {
          // Return validation errors to the client and log unexpected errors on the server.
          if (socket.readyState !== WebSocket.OPEN) return;
          if (!(err instanceof BadRequest)) console.error('WebSocket request failed:', err);
          const reason = err instanceof BadRequest ? err.message : 'server error';
          await send({ type: 'error', reason }).catch(() => socket.terminate());
        }
      });
    });

    // A pong answers the server's heartbeat. Closing removes the socket from both trackers.
    socket.on('pong', () => awaitingPong.delete(socket));
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      awaitingPong.delete(socket);
      disconnect();
    });
  });

  // At each tick, close sockets that missed the previous pong and ping the rest.
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (awaitingPong.has(socket)) {
        socket.terminate();
        continue;
      }
      awaitingPong.add(socket);
      socket.ping();
    }
  }, HEARTBEAT_MS);
  // Let Node exit when only the heartbeat timer is left.
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));
}
