// Vercel Function: POST /api/telegram — Telegram bot webhook (/start → "open the editor" button).
import { envFromProcess, handle } from '../worker/src/app.js';

export const POST = (req: Request): Promise<Response> => handle(req, envFromProcess(process.env));
