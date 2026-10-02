// Vercel Function: GET /api/link?code= — checks a link code from the bot (the editor used in a browser).
import { envFromProcess, handle } from '../worker/src/app.js';

const run = (req: Request): Promise<Response> => handle(req, envFromProcess(process.env));

export const GET = run;
export const OPTIONS = run;
