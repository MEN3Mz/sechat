const ALGORITHM = 'AES-GCM';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_BODY_LENGTH = 2000; // Matches the server's message body limit.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function webCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Message encryption requires Web Crypto over HTTPS or localhost');
  }
  return globalThis.crypto;
}

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url data');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error('Invalid base64url data');
  return bytes;
}

// Generate a shareable key on one device and transfer it to the participants out of band.
export function generateConversationSecret() {
  return encode(webCrypto().getRandomValues(new Uint8Array(KEY_BYTES)));
}

// Import the same secret on each device. The resulting CryptoKey cannot be exported.
export async function makeKey(secret) {
  if (typeof secret !== 'string' || secret.length !== 43) {
    throw new Error('Expected a 32-byte conversation secret encoded as base64url');
  }
  const bytes = decode(secret);
  return webCrypto().subtle.importKey('raw', bytes, ALGORITHM, false, ['encrypt', 'decrypt']);
}

export async function encrypt(text, key) {
  if (typeof text !== 'string') throw new TypeError('Expected message text');
  const plaintext = encoder.encode(text);
  const bodyLength = 4 + (NONCE_BYTES * 4 / 3) + Math.ceil((plaintext.length + TAG_BYTES) * 4 / 3);
  if (bodyLength > MAX_BODY_LENGTH) throw new Error('Message is too long after encryption');

  const crypto = webCrypto();
  // Encrypt each new message with a fresh nonce, even when its text matches an earlier message.
  const iv = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, plaintext);
  return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

export async function decrypt(body, key) {
  if (typeof body !== 'string' || body.length > MAX_BODY_LENGTH) throw new Error('Invalid encrypted body');
  const parts = body.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('Invalid encrypted body format');
  const iv = decode(parts[1]);
  const ciphertext = decode(parts[2]);
  if (iv.length !== NONCE_BYTES || ciphertext.length < TAG_BYTES) throw new Error('Invalid encrypted body');

  // AES-GCM rejects a modified payload or a key that cannot authenticate it.
  const plaintext = await webCrypto().subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
  return decoder.decode(plaintext);
}
