// Ring load test: client i sends to client i+1, every client at the same time.
//   node loadTest.js --clients 10 --messages 20 --protocol ws|sse|mixed [--encrypt] [--url http://127.0.0.1:8000]
// Prints latency statistics and appends one line to results.csv.
import { appendFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decrypt, encrypt, makeKey } from '../client/src/crypt.js';

const { values: o } = parseArgs({
  options: {
    clients: { type: 'string', default: '10' },
    messages: { type: 'string', default: '20' }, // per client
    protocol: { type: 'string', default: 'ws' }, // ws | sse | mixed
    interval: { type: 'string', default: '50' }, // ms between one client's messages
    url: { type: 'string', default: 'http://127.0.0.1:8000' },
    encrypt: { type: 'boolean', default: false },
  },
});
const N = Number(o.clients);
const PER = Number(o.messages);
const INTERVAL = Number(o.interval);
const key = o.encrypt ? makeKey('benchmark') : null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = (path, body) =>
  fetch(o.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const sentAt = new Map(); // message id -> time it was sent (all clients live in this one process)
const latencies = []; // ms from "sent" to "arrived at the receiver"
const wireBytes = { total: 0 };

// ---- two kinds of client, same shape: { name, send(to, id, body), close() } ----
async function wsClient(name, onMsg) {
  const socket = new WebSocket(o.url.replace(/^http/, 'ws') + '/ws');
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('cannot connect to ' + o.url));
  });
  socket.onmessage = (event) => {
    const frame = JSON.parse(event.data);
    if (frame.type === 'msg') {
      socket.send(JSON.stringify({ type: 'ack', id: frame.id }));
      onMsg(frame);
    }
  };
  socket.send(JSON.stringify({ type: 'join', user: name, token: '' }));
  return {
    send: (to, id, body) => socket.send(JSON.stringify({ type: 'msg', id, to, body })),
    close: () => socket.close(),
  };
}

async function sseClient(name, onMsg) {
  const abort = new AbortController();
  const response = await fetch(`${o.url}/sse?user=${name}`, { signal: abort.signal });
  (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const line = event.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const frame = JSON.parse(line.slice(6));
          if (frame.type === 'msg') {
            post('/ack', { user: name, id: frame.id });
            onMsg(frame);
          }
        }
      }
    } catch {} // closing the test aborts the stream
  })();
  return {
    send: (to, id, body) => post('/send', { user: name, to, id, body }),
    close: () => abort.abort(),
  };
}

// ---- run ----
let received = 0;
const expected = N * PER;
const onMsg = (frame) => {
  const t0 = sentAt.get(frame.id);
  if (t0 === undefined) return;
  sentAt.delete(frame.id); // count each message once
  latencies.push(performance.now() - t0);
  received++;
  if (key) decrypt(frame.body, key);
};

const run = Date.now().toString(36);
const clients = [];
for (let i = 0; i < N; i++) {
  const kind = o.protocol === 'mixed' ? (i % 2 ? 'sse' : 'ws') : o.protocol;
  clients.push(await (kind === 'ws' ? wsClient : sseClient)(`L${run}_${i}`, onMsg));
}
await sleep(300); // let every join finish

const started = performance.now();
await Promise.all(
  clients.map(async (client, i) => {
    const to = `L${run}_${(i + 1) % N}`;
    for (let n = 0; n < PER; n++) {
      const id = `${run}-${i}-${n}`;
      const text = `message ${n} from client ${i}`;
      const body = key ? encrypt(text, key) : text;
      sentAt.set(id, performance.now());
      client.send(to, id, body);
      await sleep(INTERVAL);
    }
  }),
);
for (let waited = 0; received < expected && waited < 15000; waited += 100) await sleep(100);
const seconds = (performance.now() - started) / 1000;
clients.forEach((c) => c.close());

latencies.sort((a, b) => a - b);
const pick = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? NaN;
const avg = latencies.reduce((s, x) => s + x, 0) / (latencies.length || 1);
const result = {
  protocol: o.protocol,
  encrypt: o.encrypt,
  clients: N,
  sent: expected,
  received,
  lost: expected - received,
  avg_ms: avg.toFixed(1),
  p50_ms: pick(0.5).toFixed(1),
  p95_ms: pick(0.95).toFixed(1),
  max_ms: pick(1).toFixed(1),
  msgs_per_sec: (received / seconds).toFixed(1),
};
console.table([result]);

const file = new URL('./results.csv', import.meta.url);
const header = Object.keys(result).join(',') + '\n';
if (!existsSync(file)) appendFileSync(file, header);
appendFileSync(file, Object.values(result).join(',') + '\n');
process.exit(0);