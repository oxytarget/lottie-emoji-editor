// Vercel Function: POST /api/telegram — Telegram bot webhook (/start, sticker packs → templates).
import { envFromProcess, handle } from '../worker/src/app.js';

export const POST = (req: Request): Promise<Response> => handle(req, envFromProcess(process.env));
