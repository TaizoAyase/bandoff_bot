// esbuild の CLI (node_modules/.bin/esbuild) は WSL2 + pnpm の組み合わせで
// 生成されるシムスクリプトが esbuild の postinstall で差し替わったネイティブ
// バイナリを誤って `node <binary>` 経由で実行してしまい動作しない。
// この環境非依存の問題を避けるため、esbuild の JS API を直接使う。
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/client/main.ts"],
  outfile: "public/js/main.js",
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
