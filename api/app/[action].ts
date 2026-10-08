// Vercel Function: /api/app/* — accounts, generations, payments, PRO and the admin panel (one function for all).
import { envFromProcess, handle } from '../../worker/src/app.js';

const run = (req: Request): Promise<Response> => handle(req, envFromProcess(process.env));

export const GET = run;
export const POST = run;
export const OPTIONS = run;
