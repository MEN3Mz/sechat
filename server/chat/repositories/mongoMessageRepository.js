import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // the unique index is our duplicate detector
  seq: { type: Number, required: true, index: true },
  from: { type: String, required: true, index: true },
  to: { type: String, required: true, index: true },
  body: { type: String, required: true },
  ts: { type: Number, required: true },
  acked: { type: Boolean, default: false }, // has the recipient confirmed it?
});

// One document per counter; $inc on it gives every message a unique, increasing seq.
const counterSchema = new mongoose.Schema({ _id: String, value: { type: Number, default: 0 } });

const Message = mongoose.model('Message', messageSchema);
const Counter = mongoose.model('Counter', counterSchema);

const DUPLICATE_KEY = 11000;

const toFrame = (doc) => ({
  type: 'msg',
  id: doc.id,
  seq: doc.seq,
  from: doc.from,
  to: doc.to,
  body: doc.body,
  ts: doc.ts,
});

export class MongoMessageRepository {
  initialize() {
    return Message.init();
  }

  async add(sender, recipient, id, body) {
    const existing = await Message.findOne({ id });
    if (existing) return { msg: toFrame(existing), isNew: false };
    const counter = await Counter.findOneAndUpdate(
      { _id: 'seq' },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    try {
      const doc = await Message.create({
        id,
        seq: counter.value,
        from: sender,
        to: recipient,
        body,
        ts: Date.now() / 1000,
      });
      return { msg: toFrame(doc), isNew: true };
    } catch (err) {
      if (err.code !== DUPLICATE_KEY) throw err;
      // two retries of the same id raced each other; the other one won
      return { msg: toFrame(await Message.findOne({ id })), isNew: false };
    }
  }

  async pendingFor(user) {
    const docs = await Message.find({ to: user, acked: false }).sort({ seq: 1 });
    return docs.map(toFrame);
  }

  async acknowledge(user, id) {
    await Message.updateOne({ id, to: user }, { acked: true });
  }

  async history(user) {
    const docs = await Message.find({ $or: [{ from: user }, { to: user }] }).sort({ seq: 1 });
    return docs.map(toFrame);
  }
}
