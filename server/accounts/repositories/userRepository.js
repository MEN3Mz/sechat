import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
});

const User = mongoose.model('User', userSchema);
const DUPLICATE_KEY = 11000;

export class UserRepository {
  initialize() {
    return User.init();
  }

  async createUser(name, passwordHash) {
    try {
      await User.create({ name, passwordHash });
      return true;
    } catch (err) {
      if (err.code === DUPLICATE_KEY) return false; // name taken
      throw err;
    }
  }

  async getPasswordHash(name) {
    const user = await User.findOne({ name });
    return user ? user.passwordHash : null;
  }
}
