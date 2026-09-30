// Vercel Function: GET /api/health — shows whether the bot token is configured.
import { envFromProcess, handle } from '../worker/src/app.js';

export const GET = (req: Request): Promise<Response> => handle(req, envFromProcess(process.env));
