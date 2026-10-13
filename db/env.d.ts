declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    ANXIN_SYNTHETIC_ENV_ID?: string;
  }
}
