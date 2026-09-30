#!/usr/bin/env node
/**
 * Points the bot's webhook at the deployed worker (POST <WORKER_URL>/telegram).
 * The secret token is derived from the bot token the same way the worker does (worker/src/telegram.ts).
 *
 *   TELEGRAM_BOT_TOKEN=... WORKER_URL=https://emoji-studio-bot.<sub>.workers.dev node scripts/set-bot-webhook.mjs
 */
import { createHash } from 'node:crypto';

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const workerUrl = process.env.WORKER_URL?.trim().replace(/\/+$/, '');
const apiBase = (process.env.TELEGRAM_API ?? 'https://api.telegram.org').replace(/\/$/, '');

if (!token || !workerUrl?.startsWith('https://')) {
  console.error('TELEGRAM_BOT_TOKEN and an https:// WORKER_URL are required.');
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

try {
  const secret = createHash('sha256').update(`emoji-studio-webhook:${token}`).digest('hex').slice(0, 48);
  await call('setWebhook', {
    url: `${workerUrl}/telegram`,
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
