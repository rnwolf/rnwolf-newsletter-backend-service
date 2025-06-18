interface CloudflareEnv {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
  GRAFANA_API_KEY: string;
  EMAIL_VERIFICATION_QUEUE: Queue<any>;
}

declare module 'cloudflare:test' {
  interface ProvidedEnv extends CloudflareEnv {}
}