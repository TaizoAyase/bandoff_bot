/**
 * エントリー(Assignment)の追加・辞退を Discord に流す本文を組み立てる
 * 純粋関数。`env` にも `fetch` にも触れない(送信自体は src/notify/discord.ts)。
 *
 * 通知先は Worker 全体で1つの Bot・1チャンネルに決まっているため、
 * どのイベント(オフ会)の話かを本文の先頭に前置する。逆に slug・URL・
 * 合言葉・引き継ぎコードなど「秘密 URL を残さない」(docs/bandoff-spec.md
 * 2.2)対象の値は、この型にもフィールドとして持たせない。
 */

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

/** Discord の `content` フィールドの上限(公式ドキュメント上の制約)。 */
const DISCORD_CONTENT_MAX_LENGTH = 2000;

const TRUNCATION_SUFFIX = "…(以下省略)";

/**
 * Discord Markdown として解釈されると表示が崩れる文字。表示名・曲名・
 * 楽器名はすべてユーザーが自由に入力できるため、`**太字**` や `` `コード` ``
 * のような記法を字面どおり表示させる。`@everyone` 等のメンション発火は
 * 送信側(discord.ts)の `allowed_mentions: { parse: [] }` が防ぐので、
 * ここでの目的はあくまで表示崩れ対策。
 */
const MARKDOWN_ESCAPE_PATTERN = /[`*_~|\\>]/g;

/**
 * 改行(`\r\n`/`\r`/`\n`)を含む C0 制御文字全般(`\x00`–`\x1F`、
 * `\x7F`)を半角スペースに置換する。
 *
 * 通知本文は「1件のエントリー変更 = 1行」のプレーンテキストとして組み立てて
 * いる。表示名・曲名・枠ラベルはユーザーが自由に入力できる値で、
 * `src/domain/validation.ts` は単一行フィールドの制御文字を除去しているが、
 * ここでも独立に潰しておく。改行を通してしまうと、表示名に
 * `"山田\n〔別オフ会〕田中さんが「偽の曲」のGt1に入りました"` のような値を
 * 仕込むことで、2行目以降があたかも別の正規の通知行であるかのように見える
 * 偽の通知を作れてしまう(主催者はこのチャンネルの通知だけを見て参加状況を
 * 把握するため、実害がある)。
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字そのものを検出して潰すための意図的な正規表現。
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/g;

function escapeMarkdown(text: string): string {
  const withoutControlChars = text.replace(CONTROL_CHAR_PATTERN, " ").trim();
  return withoutControlChars.replace(MARKDOWN_ESCAPE_PATTERN, (char) => `\\${char}`);
}

/** 高位サロゲート(サロゲートペアの上位側)の範囲。 */
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

/**
 * 2000文字を超えた分を切り詰め、末尾に省略の目印を付ける。
 * `String#slice` は UTF-16 コードユニット単位で切るため、絵文字などの
 * サロゲートペアがちょうど境界に来ると孤立した高位サロゲートを作って
 * しまう(表示崩れ・一部クライアントでのエラーの原因になる)。切り詰め
 * 位置の直前が高位サロゲートなら、そのペアごと1コードユニット余分に落とす。
 */
function truncate(content: string): string {
  if (content.length <= DISCORD_CONTENT_MAX_LENGTH) {
    return content;
  }
  let cutLength = DISCORD_CONTENT_MAX_LENGTH - TRUNCATION_SUFFIX.length;
  const boundaryCode = content.charCodeAt(cutLength - 1);
  if (boundaryCode >= HIGH_SURROGATE_MIN && boundaryCode <= HIGH_SURROGATE_MAX) {
    cutLength -= 1;
  }
  return content.slice(0, cutLength) + TRUNCATION_SUFFIX;
}

function verbFor(type: EntryChangeType): string {
  return type === "join" ? "に入りました" : "を辞退しました";
}

/**
 * 「曲名」(あれば「(n回目)」)の部分を組み立てる。`takeOrdinal` が `null`
 * なら括弧ごと出さない(`MyAssignmentItem`/`/me` 一覧と同じ表示規則)。
 */
function formatSongLabel(event: EntryChangedEvent): string {
  const songTitle = escapeMarkdown(event.songTitle);
  const ordinal = event.takeOrdinal !== null ? `(${event.takeOrdinal}回目)` : "";
  return `「${songTitle}」${ordinal}`;
}

function formatSingle(event: EntryChangedEvent): string {
  const eventTitle = escapeMarkdown(event.eventTitle);
  const participantName = escapeMarkdown(event.participantName);
  const slotLabel = escapeMarkdown(event.slotLabel);
  return `〔${eventTitle}〕${participantName}さんが${formatSongLabel(event)}の ${slotLabel} ${verbFor(event.type)}`;
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
    (event) => `- ${formatSongLabel(event)}の ${escapeMarkdown(event.slotLabel)}`,
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
