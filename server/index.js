// Start the chat server: node index.js [port] [--mongo mongodb://127.0.0.1:27017/chat]
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import express from 'express';
import { MemoryStore } from './chat/repositories/memoryStore.js';
import { Hub } from './chat/services/hub.js';
import { Metrics } from './status/services/metrics.js';
import { httpRoutes } from './chat/routes/protocolHttp.js';
import { attachWebSocket } from './chat/routes/protocolWs.js';
import { statusRoutes } from './status/routes/statusRoutes.js';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { mongo: { type: 'string' } }, // Part D: turns on MongoDB and accounts
});
const port = Number(positionals[0] ?? 8000);
const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');

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
  let messages = new MemoryStore();
  let accounts;

  if (args.mongo) {
    const { default: mongoose } = await import('mongoose');
    const { MongoMessageRepository } = await import('./chat/repositories/mongoMessageRepository.js');
    const { UserRepository } = await import('./accounts/repositories/userRepository.js');
    const { AccountService } = await import('./accounts/services/accountService.js');

    await mongoose.connect(args.mongo, { serverSelectionTimeoutMS: 4000 });
    messages = new MongoMessageRepository();
    const users = new UserRepository();
    await Promise.all([users.initialize(), messages.initialize()]);
    accounts = new AccountService(users, messages);
  }

  const hub = new Hub(messages, metrics);
  const app = express();
  app.use(express.json());
  httpRoutes(app, hub); // /sse, /send, /ack (Protocol 2)
  if (accounts) {
    const { accountRoutes } = await import('./accounts/routes/accountRoutes.js');
    hub.verifyToken = (token) => accounts.verifyToken(token);
    accountRoutes(app, accounts);
  }
  statusRoutes(app, hub, metrics);
  app.use(express.static(clientDir)); // the built React app

  // Last: turn errors (for example a request with broken JSON) into a JSON reply.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
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
