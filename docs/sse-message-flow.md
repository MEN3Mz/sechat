# SSE message flow

## From login to the next message

1. **Log in.** With MongoDB accounts enabled, Alice and Bob each send `POST /login` with `{ user, password }`. The account service checks the password and returns `{ user, token }`. In open mode, each client uses its username and skips login.
2. **Start listening.** Each client opens `GET /sse?user=...&token=...`. The controller authenticates the request and opens an SSE response. The Hub registers the connection, sends `{ type: "joined", user }`, and replays messages the recipient has yet to acknowledge.
3. **Send.** Alice creates a message ID, encrypts the text on her device, and posts `{ user, token, to: "bob", id, body }` to `/send`. The Hub stores the encrypted body and forwards it to Bob if he is connected. Alice's POST returns `{ type: "sent", id, seq }`. That response confirms the Hub accepted the message.
4. **Receive and acknowledge.** Bob's open stream receives a `msg` event carrying the ID, sender, recipient, sequence number, timestamp, and encrypted body. Bob's client decrypts the body, displays the text, and posts `{ user, token, id }` to `/ack`. The Hub records receipt and returns `{ ok: true }`.
5. **Keep listening.** The POST requests finish while both SSE streams stay open. Either user can receive the next message as soon as the Hub writes another event. The server sends a heartbeat comment every 30 seconds while the connection can accept writes.
6. **Reconnect.** If Bob's connection closes, the server removes it from the Hub. When he reopens `/sse`, the Hub replays messages he has yet to acknowledge. If Alice retries a send, she reuses the original ID and encrypted body so the store can recognize the duplicate. The client should also deduplicate incoming messages by ID in case an acknowledgment was interrupted.

`/sse` carries events from the server to the client. `/send` and `/ack` carry actions from the client to the server as separate HTTP requests. In account mode each request presents the login token. The server derives the authenticated username from that token.

## End-to-end encryption

One participant calls `generateConversationSecret()` to create a random 256-bit secret and shares it with the other participant through a separate trusted channel. Both devices call `makeKey(secret)` locally. The conversation secret is separate from the account password and the login token. On another device, import the same secret to read encrypted history.

```js
import { decrypt, encrypt, generateConversationSecret, makeKey } from './crypt.js';

// Generate once per conversation. Import this same secret on the other device.
const secret = generateConversationSecret();
const key = await makeKey(secret);

// Put this string in the body field of an HTTP or WebSocket message.
const body = await encrypt('Hey Bob!', key);

// On receipt or when rendering history, use the imported conversation key.
const text = await decrypt(body, key);
```

The body format is `v1.<nonce>.<ciphertext-and-tag>`. Both binary fields use unpadded base64url. Encryption uses AES-256-GCM and generates a fresh 12-byte nonce for every new message. Decryption rejects an invalid format, a wrong key, or modified ciphertext. A client with the wrong or missing key should keep the message locked and retry decryption after the user imports the correct key. [Web Cryptography specification](https://www.w3.org/TR/webcrypto/#aes-gcm)

Express and MongoDB handle the encrypted body as a string. They still see routing metadata such as the sender, recipient, and timestamp. The existing 2,000-character limit applies to the encoded body. The browser needs a secure context for Web Crypto. Use localhost for development or trusted HTTPS for phones connecting to the laptop over Wi-Fi. The current server entry point serves HTTP, so the phone deployment needs HTTPS in front of it.

The React screens are still pending in this checkout. Their integration points are encrypting before sending, decrypting before displaying live or historical messages, and acknowledging after processing receipt. The existing benchmark exercises the module over both transports. Start the server in open mode, then run the benchmark from the repository root with Node.js 24:

```sh
node bench/loadTest.js --clients 4 --messages 10 --protocol mixed --encrypt
```

Run the same command without `--encrypt` for a plaintext benchmark baseline. Reported latency runs from the start of preparing a message until the receiver can read it, so the encrypted run includes both encryption and decryption.
