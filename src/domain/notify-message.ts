/**
 * エントリー(Assignment)の追加・辞退を Discord に流す本文を組み立てる
 * 純粋関数。`env` にも `fetch` にも触れない(送信自体は src/notify/discord.ts)。
 *
 * 通知先は Worker 全体で1つの Bot・1チャンネルに決まっているため、
 * どのイベント(オフ会)の話かを本文の先頭に前置する。逆に slug・URL・
 * 合言葉・引き継ぎコードなど「秘密 URL を残さない」(docs/bandoff-spec.md
 * 2.2)対象の値は、この型にもフィールドとして持たせない。
 *
 * エスケープ・切り詰め・「曲名(n回目)」の組み立ては他の通知種別
 * (`notify-event.ts` 等)と共通化しており、実体は `notify-text.ts` にある。
 */

import { escapeMarkdown, formatTitleWithOrdinal, truncate } from "./notify-text";

export type EntryChangeType = "join" | "leave";

export interface EntryChangedEvent {
  readonly type: EntryChangeType;
  readonly eventTitle: string;
  readonly participantName: string;
  readonly songTitle: string;
  readonly slotLabel: string;
  /**
   * その曲の Take が2件以上のときだけ値を持つ(`MyAssignmentItem.takeOrdinal`
   * と同じ規則。「Take が1件だけなら回数を出さない」という既存の表示規則に
   * 合わせる)。
   */
  readonly takeOrdinal: number | null;
}

function verbFor(type: EntryChangeType): string {
  return type === "join" ? "に入りました" : "を辞退しました";
}

function formatSingle(event: EntryChangedEvent): string {
  const eventTitle = escapeMarkdown(event.eventTitle);
  const participantName = escapeMarkdown(event.participantName);
  const slotLabel = escapeMarkdown(event.slotLabel);
  const songLabel = formatTitleWithOrdinal(event.songTitle, event.takeOrdinal);
  return `〔${eventTitle}〕${participantName}さんが${songLabel}の ${slotLabel} ${verbFor(event.type)}`;
}

/**
 * 複数件をまとめて1通にする。呼び出し元は主催者による一括辞退のみを想定し
 * ており、`events` は同じ参加者・同じイベントのエントリーがまとまっている
 * 前提(Discord のレート制限を避けるため1曲ずつ送らずまとめる、計画参照)。
 * 先頭の要素を見出し(イベント名・参加者名・種別)の代表として使う。
 * `verbFor(first.type)` により join 側の複数件文言も生成できるが、現状
 * 複数件をまとめて送る呼び出し元は一括辞退(leave)のみで、複数 join を
 * まとめて送る呼び出し元は無い(将来の一括参加機能に備えた分岐)。
 */
function formatMultiple(
  events: readonly [EntryChangedEvent, ...EntryChangedEvent[]],
): string {
  const [first] = events;
  const eventTitle = escapeMarkdown(first.eventTitle);
  const participantName = escapeMarkdown(first.participantName);
  const lines = events.map(
    (event) =>
      `- ${formatTitleWithOrdinal(event.songTitle, event.takeOrdinal)}の ${escapeMarkdown(event.slotLabel)}`,
  );
  return [
    `〔${eventTitle}〕${participantName}さんが以下のエントリー${verbFor(first.type)}`,
    ...lines,
  ].join("\n");
}

/**
 * エントリーの変更内容から Discord に送る本文を組み立てる。
 * 空配列なら送るものがないので `null` を返す(呼び出し側はここで送信を
 * やめる)。
 */
export function buildEntryChangedContent(
  events: readonly EntryChangedEvent[],
): string | null {
  const [first, ...rest] = events;
  if (!first) {
    return null;
  }
  if (rest.length === 0) {
    return truncate(formatSingle(first));
  }
  return truncate(formatMultiple([first, ...rest]));
}
