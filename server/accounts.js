// Feature 1: register, log in, and fetch message history. Only active with --mongo.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { USERNAME } from './hub.js';

// Anyone who knows this secret can forge logins. Set JWT_SECRET to something private.
const SECRET = process.env.JWT_SECRET || 'classroom-secret-change-me';

const bad = (res, status, reason) => res.status(status).json({ type: 'error', reason });
const sign = (user) => jwt.sign({ user }, SECRET, { expiresIn: '7d' });

export function accountRoutes(app, hub) {
  const store = hub.store; // needs createUser, getPasswordHash and history (mongoStore.js)

  // This one line switches the whole server from "open" to "token required".
  hub.verifyToken = (token) => {
    try {
      return jwt.verify(token, SECRET).user;
    } catch {
      return null; // missing, forged or expired token
    }
  };

  app.post('/register', async (req, res) => {
    const { user, password } = req.body ?? {};
    if (typeof user !== 'string' || !USERNAME.test(user)) {
      return bad(res, 400, 'username must be 1-20 letters, digits or _');
    }
    if (typeof password !== 'string' || password.length < 4) {
      return bad(res, 400, 'password must be at least 4 characters');
    }
    const created = await store.createUser(user, await bcrypt.hash(password, 10));
    if (!created) return bad(res, 409, 'that username is taken');
    res.json({ token: sign(user), user });
  });

  app.post('/login', async (req, res) => {
    const { user, password } = req.body ?? {};
    const hash = typeof user === 'string' ? await store.getPasswordHash(user) : null;
    if (typeof password !== 'string' || !hash || !(await bcrypt.compare(password, hash))) {
      return bad(res, 401, 'wrong username or password');
    }
    res.json({ token: sign(user), user });
  });

  // GET /history?token=... : every message this user sent or received, oldest first.
  app.get('/history', async (req, res) => {
    const user = hub.verifyToken(req.query.token);
    if (!user) return bad(res, 401, 'bad token');
    res.json({ messages: await store.history(user) });
  });
}