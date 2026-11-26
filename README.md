# sechat
Real-time messaging app – CSEN 503 project

## Server architecture

`routes → controllers → services → repositories`

- `server/accounts/` contains registration, login, history, JWT authentication, and the user repository.
- `server/chat/` contains WebSocket, SSE, sending and acknowledgment endpoints, the delivery service, and the message repositories.
- `server/status/` contains config, users, metrics, and stats endpoints with the metrics service.

Inside each feature, files live in `routes/`, `controllers/`, `services/`, or `repositories/` according to their role. Shared username validation lives in `server/shared/validation/`.

The account service receives the chat message repository to retrieve history.

`server/index.js` wires the layers together. It uses the in-memory repository by default. Start it with `--mongo <uri>` to enable MongoDB, accounts, and message history.

See [the SSE message flow](docs/sse-message-flow.md) for the login-to-delivery walkthrough and client encryption API.
