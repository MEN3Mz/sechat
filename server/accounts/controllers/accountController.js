import { AccountError } from '../services/accountService.js';

export function accountController(accounts) {
  function respond(action) {
    return async (req, res) => {
      try {
        res.json(await action(req));
      } catch (err) {
        if (!(err instanceof AccountError)) throw err;
        res.status(err.status).json({ type: 'error', reason: err.message });
      }
    };
  }

  return {
    register: respond(({ body }) => accounts.register(body?.user, body?.password)),
    login: respond(({ body }) => accounts.login(body?.user, body?.password)),
    history: respond(async ({ query }) => ({ messages: await accounts.history(query.token) })),
  };
}
