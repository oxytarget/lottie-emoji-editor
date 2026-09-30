// Cloudflare Workers entry point.
import { handle, type Env } from './app.js';

export default {
  fetch: (req: Request, env: Env): Promise<Response> => handle(req, env),
};
