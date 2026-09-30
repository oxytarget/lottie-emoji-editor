/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the bot backend (worker/) — enables "send to chat" inside Telegram. */
  readonly VITE_BOT_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
