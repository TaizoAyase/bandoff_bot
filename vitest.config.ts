import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // JSX (jsx: react-jsx, jsxImportSource: hono/jsx) は tsconfig.json の
  // compilerOptions から Vite 8 既定の oxc トランスフォーマが直接読み取って
  // 変換する。esbuild 用の jsx オプションは oxc からは無視され
  // 「Both esbuild and oxc options were set」という警告の原因にしかならない
  // ため、ここでは設定しない。
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations("./migrations");
      return {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // @cloudflare/vitest-pool-workers@0.22.0 が依存する miniflare
          // (5.20260815.0-alpha 系)が同梱する workerd は 2026-08-22 までしか
          // compatibility_date をサポートしていない。wrangler.toml 自体は
          // 本日の日付(2026-09-04)のままにし、テスト実行時だけこの値で上書きする。
          compatibilityDate: "2026-08-22",
          bindings: {
            SESSION_SECRET: "test-session-secret",
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
