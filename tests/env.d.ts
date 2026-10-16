import type { D1Migration } from '@cloudflare/vitest-plugin';

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    ASSETS: Fetcher;
    APP_ENV: string;
    AUTH_PASSWORD_PEPPER: string;
    AUTH_SESSION_SECRET: string;
    BOOTSTRAP_TOKEN: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}
