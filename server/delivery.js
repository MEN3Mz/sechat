// Message storage and delivery rules (no network code in here).
//
// Rules implemented:
//   * a message id we have already seen is a duplicate -> never stored/delivered twice
//   * every message gets a server-side sequence number (seq)
//   * a message stays "unacknowledged" for its recipient until they ack it

export class MemoryStore {
  constructor() {
    this.nextSeq = 1;
    this.byId = new Map(); // message id -> message (used to spot duplicates)
    this.unacked = new Map(); // user name -> Map(message id -> message)
  }

  // Store a new message. Returns { msg, isNew }.
  async add(sender, recipient, id, body) {
    // The sender retried: return the stored copy, do not store it again.
    if (this.byId.has(id)) return { msg: this.byId.get(id), isNew: false };
    const msg = {
      type: 'msg',
      id,
      seq: this.nextSeq++,
      from: sender,
      to: recipient,
      body,
      ts: Date.now() / 1000,
    };
    this.byId.set(id, msg);
    if (!this.unacked.has(recipient)) this.unacked.set(recipient, new Map());
    this.unacked.get(recipient).set(id, msg);
    return { msg, isNew: true };
  }

  // Messages this user has not acknowledged yet, oldest first.
  async pendingFor(user) {
    const pending = this.unacked.get(user);
    return pending ? [...pending.values()].sort((a, b) => a.seq - b.seq) : [];
  }

  // The recipient confirmed they received this message.
  async acknowledge(user, id) {
    this.unacked.get(user)?.delete(id);
  }
}