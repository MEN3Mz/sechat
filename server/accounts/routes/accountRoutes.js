import { accountController } from '../controllers/accountController.js';

export function accountRoutes(app, accounts) {
  const controller = accountController(accounts);
  app.post('/register', controller.register);
  app.post('/login', controller.login);
  app.get('/history', controller.history);
}
