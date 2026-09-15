import type { Context } from "hono";
import {
  buildEntryChangedContent,
  type EntryChangedEvent,
} from "../domain/notify-message";
import type { AppEnv } from "../env";
import { scheduleNotification } from "./schedule";

/**
 * エントリーの追加・辞退が起きたときの呼び出し口。実体は汎用の
 * `scheduleNotification`(no-op 判定・fire-and-forget・エラー握りつぶしは
 * すべてそちら任せ)の上に、本文組み立て(`buildEntryChangedContent`)を
 * 載せただけの薄いラッパ。既存の呼び出し元(songs.ts の join/leave、
 * participants.ts の一括辞退)の挙動は変えない。
 */
export function notifyEntryChanged(
  c: Context<AppEnv>,
  events: readonly EntryChangedEvent[],
): void {
  scheduleNotification(c, async () => buildEntryChangedContent(events));
}
