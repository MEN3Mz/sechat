import { statusController } from '../controllers/statusController.js';

export function statusRoutes(app, hub, metrics) {
  const controller = statusController(hub, metrics);
  app.get('/config', controller.config);
  app.get('/metrics', controller.metrics);
  app.get('/users', controller.users);
  app.get('/stats', controller.stats);
}
