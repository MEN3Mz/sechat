// The Hub: who is connected, and how a message gets from one person to another.

export const USERNAME = /^[A-Za-z0-9_]{1,20}$/;
const MAX_BODY = 2000;
const MAX_ID = 64;

// Thrown when a client sends something invalid. The message is shown to the client.
export class BadRequest extends Error {}

// One open connection (one phone). `send` is an async function that takes an object.
export class Connection {
  constructor(user, protocol, send) {
    this.user = user;
    this.protocol = protocol; // 'ws' or 'sse'
    this.send = send;
  }
}

export class Hub {
  constructor(store, metrics) {
    this.store = store;
    this.metrics = metrics;
    this.connections = new Map(); // user name -> Set of Connection
    this.knownUsers = new Set();
    this.verifyToken = null; // Part D sets this to a function(token) -> user name or null
  }

  // ---- who is this? ----
  authenticate(user, token) {
    if (this.verifyToken) return this.verifyToken(token); // accounts mode: the token decides
    return typeof user === 'string' && USERNAME.test(user) ? user : null; // open mode: any valid name
  }

  // ---- connecting and disconnecting ----
  async join(conn) {
    if (!this.connections.has(conn.user)) this.connections.set(conn.user, new Set());
    this.connections.get(conn.user).add(conn);
    this.knownUsers.add(conn.user);
    this.metrics.connectionOpened(conn.protocol);
    console.log(`${conn.user} joined via ${conn.protocol}`);
    await this.safeSend(conn, { type: 'joined', user: conn.user });
    // Offline sync: resend everything this user never acknowledged.
    for (const msg of await this.store.pendingFor(conn.user)) {
      await this.safeSend(conn, msg);
    }
  }

  // Called when a connection closes, for any reason. Never throws.
  leave(conn) {
    const conns = this.connections.get(conn.user);
    if (!conns || !conns.delete(conn)) return; // already gone
    if (conns.size === 0) this.connections.delete(conn.user);
    this.metrics.connectionClosed(conn.protocol);
    console.log(`${conn.user} left (${conn.protocol})`);
  }

  // ---- messages ----
  // Validate, store and forward a message. Returns the stored message.
  async submit(sender, to, id, body) {
    if (typeof to !== 'string' || !USERNAME.test(to)) throw new BadRequest('bad recipient name');
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID) throw new BadRequest('bad message id');
    if (typeof body !== 'string' || body.length === 0 || body.length > MAX_BODY) throw new BadRequest('bad message body');
    const { msg, isNew } = await this.store.add(sender, to, id, body);
    if (isNew) {
      this.metrics.messageReceived();
      const recipients = [...(this.connections.get(to) ?? [])]; // a copy: safeSend may remove entries
      await Promise.all(recipients.map((conn) => this.safeSend(conn, msg)));
    }
    return msg;
  }

  acknowledge(user, id) {
    return this.store.acknowledge(user, id);
  }

  // ---- helpers ----
  // Send to one connection. If that connection is broken, drop only it.
  async safeSend(conn, frame) {
    try {
      await conn.send(frame);
    } catch (err) {
      // a dead socket must never hurt other clients
      console.warn(`send to ${conn.user} failed (${err.message}): dropping connection`);
      this.leave(conn);
    }
  }

  users() {
    return { online: [...this.connections.keys()].sort(), known: [...this.knownUsers].sort() };
  }
}