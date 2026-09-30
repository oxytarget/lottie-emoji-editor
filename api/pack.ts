// Vercel Function: POST /api/pack — the bot creates (or extends) a custom emoji pack for the user.
import { envFromProcess, handle } from '../worker/src/app.js';

const run = (req: Request): Promise<Response> => handle(req, envFromProcess(process.env));

export const POST = run;
export const OPTIONS = run;
