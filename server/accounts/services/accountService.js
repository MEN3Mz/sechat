// Feature 1: register, log in, and fetch message history. Only active with --mongo.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { USERNAME } from '../../shared/validation/username.js';

// Anyone who knows this secret can forge logins. Set JWT_SECRET to something private.
const SECRET = process.env.JWT_SECRET || 'classroom-secret-change-me';

export class AccountError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sign = (user) => jwt.sign({ user }, SECRET, { expiresIn: '7d' });

export class AccountService {
  constructor(userRepository, messageRepository) {
    this.userRepository = userRepository;
    this.messageRepository = messageRepository;
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, SECRET).user;
    } catch {
      return null;
    }
  }

  async register(user, password) {
    if (typeof user !== 'string' || !USERNAME.test(user)) {
      throw new AccountError(400, 'username must be 1-20 letters, digits or _');
    }
    if (typeof password !== 'string' || password.length < 4) {
      throw new AccountError(400, 'password must be at least 4 characters');
    }
    const created = await this.userRepository.createUser(user, await bcrypt.hash(password, 10));
    if (!created) throw new AccountError(409, 'that username is taken');
    return { token: sign(user), user };
  }

  async login(user, password) {
    const hash = typeof user === 'string' ? await this.userRepository.getPasswordHash(user) : null;
    if (typeof password !== 'string' || !hash || !(await bcrypt.compare(password, hash))) {
      throw new AccountError(401, 'wrong username or password');
    }
    return { token: sign(user), user };
  }

  async history(token) {
    const user = this.verifyToken(token);
    if (!user) throw new AccountError(401, 'bad token');
    return this.messageRepository.history(user);
  }
}
