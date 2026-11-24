// Start the chat server: node index.js [port] [--mongo mongodb://127.0.0.1:27017/chat]
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import express from 'express';
import { MemoryStore } from './delivery.js';
import { Hub } from './hub.js';
import { Metrics } from './metrics.js';
import { httpRoutes } from './protocolHttp.js';
import { attachWebSocket } from './protocolWs.js';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { mongo: { type: 'string' } }, // Part D: turns on MongoDB and accounts
});
const port = Number(positionals[0] ?? 8000);
const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');

const STATS_PAGE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Server stats</title>
<body style="font-family:sans-serif;max-width:480px;margin:2em auto">
<h2>Server stats</h2><table id=t border=1 cellpadding=6 style="border-collapse:collapse"></table>
<script>
async function tick(){
  const m = await (await fetch('/metrics')).json();
  document.getElementById('t').innerHTML = Object.entries(m)
    .map(([k,v]) => '<tr><td>'+k+'</td><td>'+JSON.stringify(v)+'</td></tr>').join('');
}
tick(); setInterval(tick, 1000);
</script></body>`;

// The addresses phones can type. A laptop may have several (Wi-Fi, VPN, virtual adapters).
function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal) found.push({ name, address: n.address });
    }
  }
  return found;
}

async function main() {
  const metrics = new Metrics();
  let store = new MemoryStore();
  if (args.mongo) {
    const { connectMongo } = await import('./mongoStore.js'); // only loaded when asked for
    store = await connectMongo(args.mongo);
  }
  const hub = new Hub(store, metrics);

  const app = express();
  app.use(express.json());
  httpRoutes(app, hub); // /sse, /send, /ack (Protocol 2)
  if (args.mongo) {
    const { accountRoutes } = await import('./accounts.js');
    accountRoutes(app, hub); // /register, /login, /history
  }
  app.get('/config', (req, res) => res.json({ accounts: hub.verifyToken !== null }));
  app.get('/metrics', (req, res) => res.json(metrics.snapshot()));
  app.get('/users', (req, res) => res.json(hub.users()));
  app.get('/stats', (req, res) => res.type('html').send(STATS_PAGE));
  app.use(express.static(clientDir)); // the built React app

  // Last: turn errors (for example a request with broken JSON) into a JSON reply.
  app.use((err, req, res, next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ type: 'error', reason: status === 400 ? 'bad request body' : 'server error' });
  });

  const server = http.createServer(app);
  attachWebSocket(server, hub); // /ws (Protocol 1)

  // 0.0.0.0 = listen on every network interface, so phones on the Wi-Fi can connect
  server.listen(port, '0.0.0.0', () => {
    console.log('\n  Open on your phone (pick the address on your Wi-Fi):');
    for (const { name, address } of lanAddresses()) console.log(`    http://${address}:${port}   (${name})`);
    console.log(`  Live statistics:   http://localhost:${port}/stats`);
    if (args.mongo) console.log(`  MongoDB and accounts: ON (${args.mongo})`);
    console.log('');
  });
}

main().catch((err) => {
  console.error('Could not start:', err.message);
  process.exit(1);
});