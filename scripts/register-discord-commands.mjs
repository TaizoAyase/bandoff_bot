// Discord のスラッシュコマンド(/bandoff open・list・new)を、`bandoff` を
// 使うギルド(サーバー)のコマンドとして登録する(計画9章)。
//
// 依存パッケージを追加せず Node 組み込みの `fetch` だけを使う。
// **実行はユーザー自身が行うこと。エージェントはこのスクリプトを実行しない**。
//
// 使い方:
//   .dev.vars.register (gitignore 済み) に以下を書いてから
//     DISCORD_APPLICATION_ID=...
//     DISCORD_GUILD_ID=...
//     DISCORD_BOT_TOKEN=...
//   `pnpm discord:register` を実行する。
//
// Token・ID・Discord からの応答本文はログに出さない。失敗時は HTTP
// ステータスと Discord のエラー `code`/`message` だけを出す。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SNOWFLAKE_RE = /^\d{1,20}$/;

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`環境変数 ${name} が設定されていません`);
    process.exit(1);
  }
  return value;
}

function requireSnowflake(name, value) {
  if (!SNOWFLAKE_RE.test(value)) {
    console.error(`環境変数 ${name} が snowflake 形式ではありません`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const applicationId = requireSnowflake(
    "DISCORD_APPLICATION_ID",
    readRequiredEnv("DISCORD_APPLICATION_ID"),
  );
  const guildId = requireSnowflake(
    "DISCORD_GUILD_ID",
    readRequiredEnv("DISCORD_GUILD_ID"),
  );
  const botToken = readRequiredEnv("DISCORD_BOT_TOKEN");

  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const commandsPath = path.join(dirname, "discord-commands.json");
  const commands = JSON.parse(readFileSync(commandsPath, "utf8"));

  const url = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    // 応答本文全体はログに出さない。Discord のエラー code/message だけを
    // 添える(取得できなければ何も添えない)。
    let code;
    let message;
    try {
      const errorBody = await response.json();
      if (errorBody && typeof errorBody === "object") {
        code = errorBody.code;
        message = errorBody.message;
      }
    } catch {
      // 応答が JSON でなければ黙って無視する。
    }
    console.error("コマンド登録に失敗しました", {
      status: response.status,
      code,
      message,
    });
    process.exit(1);
  }

  const registered = await response.json();
  const names = Array.isArray(registered)
    ? registered.map((command) => command.name).join(", ")
    : "";
  console.log(`コマンドを登録しました: ${names}`);
}

main().catch((err) => {
  console.error("コマンド登録に失敗しました", {
    error: err instanceof Error ? err.name : typeof err,
  });
  process.exit(1);
});
