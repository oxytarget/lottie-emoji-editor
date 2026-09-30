// Vercel Function: GET /api/stickerset — sticker packs as editor templates (see worker/src/templates.ts).
import { envFromProcess, handle } from '../worker/src/app.js';

export const GET = (req: Request): Promise<Response> => handle(req, envFromProcess(process.env));
