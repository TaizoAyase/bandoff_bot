/**
 * エントリー(Assignment)の追加・辞退が起きたときのフック地点。
 *
 * フェーズ1では Discord Webhook 通知を実装しない(計画参照)。
 * 将来ここで Webhook 送信処理を行う想定で、呼び出し口だけを no-op として
 * 用意しておく。呼び出し側(join/leave・代理操作)は M2 以降で配線する。
 */

export type EntryChangeType = "join" | "leave";

export interface EntryChangedEvent {
  readonly type: EntryChangeType;
  readonly eventId: string;
  readonly participantId: string;
  readonly participantName: string;
  readonly songTitle: string;
  readonly slotLabel: string;
}

/**
 * @param _event エントリーの変更内容。将来 Discord Webhook 送信に使う想定。
 */
export function onEntryChanged(_event: EntryChangedEvent): void {
  // no-op: フェーズ1では通知を行わない。
}
