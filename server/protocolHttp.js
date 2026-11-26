import { httpChatController } from './controllers/httpChatController.js';

export function httpRoutes(app, hub) {
  const controller = httpChatController(hub);
  app.get('/sse', controller.stream); // Keep one response open for incoming messages.
  app.post('/send', controller.send); // Submit an outgoing message in a separate request.
  app.post('/ack', controller.acknowledge); // Confirm receipt of an incoming message.
}
