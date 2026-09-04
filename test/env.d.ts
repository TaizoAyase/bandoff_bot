import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// vitest.config.ts で miniflare.bindings に直接注入しているテスト専用バインディング。
// `cloudflare:test` の `env` は `Cloudflare.Env` 型なので、そこに追加する。
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
