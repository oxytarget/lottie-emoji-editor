// Vercel Function: POST /api/send — the bot sends exported emoji files to the user's chat.
import { envFromProcess, handle } from '../worker/src/app.js';

const run = (req: Request): Promise<Response> => handle(req, envFromProcess(process.env));

export const POST = run;
export const OPTIONS = run;
