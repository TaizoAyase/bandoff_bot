import type { Context } from "hono";
import type { AppEnv } from "../env";
import { postChannelMessage } from "./discord";

/**
 * Discord 通知の汎用の呼び出し口。ルート側で DB クエリを済ませてから呼ぶ
 * `notifyEntryChanged` と違い、本文作成のために追加のクエリ(件数・順位・
 * ラベルなど)が要る通知はこちらを使う。
 *
 * - `DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID` のどちらかが無ければ `build`
 *   を呼ばずに即座に return する(通知が無効なら、本文作成のための追加の
 *   D1 クエリも走らせない)
 * - `build` の実行(DB クエリを伴いうる)と送信をまとめて `waitUntil` に
 *   載せる fire-and-forget にする。本文作成のクエリが失敗しても、送信が
 *   失敗しても、ユーザーの操作を 500 にしない・応答も待たせない
 * - `build` が `null` を返したら送らない(変更なし・レート制限などで
 *   意図的に省く場合)
 */
export function scheduleNotification(
  c: Context<AppEnv>,
  build: () => Promise<string | null>,
): void {
  const botToken = c.env.DISCORD_BOT_TOKEN;
  const channelId = c.env.DISCORD_CHANNEL_ID;
  if (!botToken || !channelId) {
    return;
  }

  const task = (async () => {
    let content: string | null;
    try {
      content = await build();
    } catch (err) {
      // 本文作成(DB クエリ)の失敗はユーザーの操作を巻き込まない。値は
      // ログに出さない。
      console.warn("discord notify failed", {
        error: err instanceof Error ? err.name : typeof err,
      });
      return;
    }
    if (content === null) {
      return;
    }
    await postChannelMessage(botToken, channelId, content);
  })();

  try {
    // `c.executionCtx` はコンテキストが無いと throw する(テストで
    // ExecutionContext を渡していない呼び出し経路など)。その場合でも
    // ユーザーの操作自体を 500 にしたくないので、waitUntil をあきらめて
    // 投げっぱなしにするだけにする。
    c.executionCtx.waitUntil(task);
  } catch {
    void task.catch(() => {});
  }
}
