#!/usr/bin/env node
/**
 * Points the bot's webhook at the deployed backend (POST <BACKEND_URL>/api/telegram).
 * The secret token is derived from the bot token the same way the backend does (worker/src/telegram.ts).
 *
 *   TELEGRAM_BOT_TOKEN=... BACKEND_URL=https://<project>.vercel.app node scripts/set-bot-webhook.mjs
 */
import { createHash } from 'node:crypto';

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const backendUrl = (process.env.BACKEND_URL || process.env.WORKER_URL)?.trim().replace(/\/+$/, '');
const apiBase = (process.env.TELEGRAM_API ?? 'https://api.telegram.org').replace(/\/$/, '');

if (!token || !backendUrl?.startsWith('https://')) {
  console.error('TELEGRAM_BOT_TOKEN and an https:// BACKEND_URL are required.');
  process.exit(1);
}

async function call(method, params = {}) {
  const res = await fetch(`${apiBase}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

/** Makes sure the URL really is this bot's backend before pointing the webhook at it. */
async function checkBackend(botId) {
  let res;
  try {
    res = await fetch(`${backendUrl}/api/health`, { redirect: 'manual' });
  } catch (err) {
    throw new Error(`cannot reach ${backendUrl} (${err instanceof Error ? err.message : err})`);
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    throw new Error(`${backendUrl} requires a login (HTTP ${res.status}). On Vercel use the production domain (Project → Domains) or turn off Deployment Protection.`);
  }
  if (res.status === 500 && body?.error === 'not-configured') {
    throw new Error('the backend has no TELEGRAM_BOT_TOKEN — add it in the hosting settings and redeploy.');
  }
  if (!res.ok || body?.service !== 'emoji-studio-bot') {
    throw new Error(`${backendUrl}/api/health is not the Emoji Studio backend (HTTP ${res.status}). Check the URL.`);
  }
  if (body.bot !== botId) {
    throw new Error(`the backend uses a different bot token (bot ${body.bot}, expected ${botId}). Update TELEGRAM_BOT_TOKEN there and redeploy.`);
  }
  console.log(`✓ Backend ${backendUrl} is up and uses this bot`);
}

try {
  const me = await call('getMe');
  await checkBackend(me.id);
  const secret = createHash('sha256').update(`emoji-studio-webhook:${token}`).digest('hex').slice(0, 48);
  await call('setWebhook', {
    url: `${backendUrl}/api/telegram`,
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
  const info = await call('getWebhookInfo');
  console.log(`✓ Webhook: ${info.url}`);
  if (info.last_error_message) console.log(`  last error: ${info.last_error_message}`);
} catch (err) {
  console.error(`Webhook setup failed: ${String(err instanceof Error ? err.message : err).replaceAll(token, '***')}`);
  process.exit(1);
}
