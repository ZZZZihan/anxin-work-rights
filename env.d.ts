declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    ANXIN_MATERIAL_SERVICE_URL?: string;
    ANXIN_MATERIAL_SERVICE_TOKEN?: string;
  }
}
