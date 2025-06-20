interface CloudflareEnv {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
  GRAFANA_API_KEY: string;
  EMAIL_VERIFICATION_QUEUE: Queue<any>;
  MAILCHANNEL_API_KEY: string;
  SENDER_EMAIL: string;
  SENDER_NAME: string;
  MAILCHANNEL_AUTH_ID?: string; // Optional
}

declare module 'cloudflare:test' {
  interface ProvidedEnv extends CloudflareEnv {}
}