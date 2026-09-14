import type { Context } from "hono";
import {
  buildEntryChangedContent,
  type EntryChangedEvent,
} from "../domain/notify-message";
import type { AppEnv } from "../env";
import { postChannelMessage } from "./discord";

/**
 * エントリーの追加・辞退が起きたときの呼び出し口。
 * `DISCORD_BOT_TOKEN`・`DISCORD_CHANNEL_ID`(いずれも secret、Worker 全体で
 * 1組)の両方が設定されていなければ完全な no-op にする(通知はオプトイン
 * 機能で、ローカル開発では既定で無効)。
 *
 * 送信は `waitUntil` に載せた fire-and-forget で行う。Discord への POST を
 * `await` して応答(redirect)を遅らせると、Bot 側の遅延がそのまま
 * ユーザー体験の遅延になってしまうため。
 */
export function notifyEntryChanged(
  c: Context<AppEnv>,
  events: readonly EntryChangedEvent[],
): void {
  const botToken = c.env.DISCORD_BOT_TOKEN;
  const channelId = c.env.DISCORD_CHANNEL_ID;
  if (!botToken || !channelId) {
    return;
  }
  const content = buildEntryChangedContent(events);
  if (content === null) {
    return;
  }

  const send = postChannelMessage(botToken, channelId, content);
  try {
    // `c.executionCtx` はコンテキストが無いと throw する(テストで
    // ExecutionContext を渡していない呼び出し経路など)。その場合でも
    // ユーザーの操作自体を 500 にしたくないので、waitUntil をあきらめて
    // 投げっぱなしにするだけにする。
    c.executionCtx.waitUntil(send);
  } catch {
    void send.catch(() => {});
  }
}
