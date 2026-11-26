import { BadRequest, Connection } from '../services/hub.js';

const HEARTBEAT_MS = 30_000;

function replyError(res, status, reason) {
  res.status(status).json({ type: 'error', reason });
}

// Example flow with accounts enabled:
// 1. Alice and Bob each POST { user, password } to /login and get back { user, token }.
//    In open mode, skip login and identify each client by its username.
// 2. Each client opens GET /sse?user=...&token=... and listens on that response.
//    The Hub sends a joined event, then replays messages the client still needs to acknowledge.
// 3. Alice POSTs { user, token, to: 'bob', id, body } to /send. The Hub stores the
//    message and pushes it to Bob's open stream. Alice gets a sent response on her POST.
// 4. After receiving the message, Bob POSTs { user, token, id } to /ack.
//    Bob keeps listening on the same SSE stream for the next message. Alice's stream
//    also stays open, so she can receive Bob's reply whenever he sends one.
export function httpChatController(hub) {
  function withSender(action) {
    return async (req, res) => {
      const body = req.body ?? {};
      // Each POST is a separate HTTP request, so authenticate it independently of the stream.
      const user = hub.authenticate(body.user, body.token);
      if (!user) return replyError(res, 401, 'invalid username or token');
      try {
        res.json(await action(user, body));
      } catch (err) {
        if (!(err instanceof BadRequest)) throw err;
        replyError(res, 400, err.message);
      }
    };
  }

  return {
    async stream(req, res) {
      const user = hub.authenticate(req.query.user, req.query.token);
      if (!user) return replyError(res, 401, 'invalid username or token');

      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      // Start the response now so the client can listen while the server keeps writing events.
      res.flushHeaders();
      const conn = new Connection(user, 'sse', (frame) => new Promise((resolve, reject) => {
        // SSE uses a data line followed by a blank line to mark the end of an event.
        const data = `data: ${JSON.stringify(frame)}\n\n`;
        res.write(data, (err) => {
          if (err) return reject(err);
          hub.metrics.bytesOut += Buffer.byteLength(data);
          resolve();
        });
      }));

      // SSE comments keep the idle stream active without generating a client message event.
      const heartbeat = setInterval(() => {
        if (!res.writableNeedDrain) res.write(': heartbeat\n\n');
      }, HEARTBEAT_MS);
      // When this stream closes, stop its timer and remove the connection from the Hub.
      res.once('close', () => {
        clearInterval(heartbeat);
        hub.leave(conn);
      });
      try {
        await hub.join(conn);
      } catch (err) {
        console.error('SSE connection failed:', err);
        res.destroy();
      }
    },
    send: withSender(async (user, { to, id, body }) => {
      // If the recipient is offline, the stored message stays pending for their next connection.
      const message = await hub.submit(user, to, id, body);
      return { type: 'sent', id: message.id, seq: message.seq };
    }),
    acknowledge: withSender(async (user, { id }) => {
      // Mark this recipient's message as received so the Hub can skip it on reconnect.
      await hub.acknowledge(user, id);
      return { ok: true };
    }),
  };
}
