interface CloudflareEnv {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
  GRAFANA_API_KEY: string;
}

declare module 'cloudflare:test' {
  interface ProvidedEnv extends CloudflareEnv {}
}