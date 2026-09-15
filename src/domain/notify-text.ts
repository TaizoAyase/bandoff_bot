/**
 * Discord 通知本文の組み立てで共通して使う純粋関数
 * (エスケープ・切り詰め・行為者表記・差分行)。`src/domain/notify-message.ts`
 * (既存のエントリー変更通知)と、種類別の本文 builder(`notify-event.ts` 等)の
 * 両方から使われる。env / DB / fetch には一切触れない。
 */

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
 * 通知本文は「1件 = 1行」のプレーンテキストとして組み立てている。
 * ユーザーが自由に入力できる値はどれも `src/domain/validation.ts` が
 * 単一行フィールドの制御文字を除去しているが、ここでも独立に潰しておく。
 * 改行を通してしまうと、値に別イベントの通知文言そのものを仕込むことで、
 * 2行目以降があたかも別の正規の通知行であるかのように見える偽の通知を
 * 作れてしまう(主催者はこのチャンネルの通知だけを見て状況を把握するため、
 * 実害がある。[[notify-newline-injection-fix]] の2層防御の通知側)。
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字そのものを検出して潰すための意図的な正規表現。
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/g;

/** 制御文字を潰し、Markdown 記号をエスケープする。 */
export function escapeMarkdown(text: string): string {
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
export function truncate(content: string): string {
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

/**
 * 「曲名」(あれば「(n回目)」)の部分を組み立てる。`takeOrdinal` が `null`
 * なら括弧ごと出さない(`MyAssignmentItem`/`/me` 一覧と同じ表示規則)。
 */
export function formatTitleWithOrdinal(
  title: string,
  takeOrdinal: number | null,
): string {
  const escaped = escapeMarkdown(title);
  const ordinal = takeOrdinal !== null ? `(${takeOrdinal}回目)` : "";
  return `「${escaped}」${ordinal}`;
}

/**
 * 行為者の表記。participant があれば `{表示名}さんが`、無ければ
 * (主催者キーだけの cookie)`主催者が`(計画の共通規則)。
 */
export function formatActor(displayName: string | null): string {
  return displayName === null ? "主催者が" : `${escapeMarkdown(displayName)}さんが`;
}

/** 変更前 → 変更後の中で、空の値を表す表記(計画の共通規則)。 */
const EMPTY_VALUE_LABEL = "(なし)";

function formatDiffValue(value: string): string {
  return value === "" ? EMPTY_VALUE_LABEL : escapeMarkdown(value);
}

/**
 * 「- {label}: 旧 → 新」の1行を組み立てる。値が変わっていなければ
 * `null`(呼び出し側は行ごと省く)。
 */
export function diffLine(label: string, before: string, after: string): string | null {
  if (before === after) {
    return null;
  }
  return `- ${label}: ${formatDiffValue(before)} → ${formatDiffValue(after)}`;
}

/**
 * 備考・参考 URL のように値そのものを本文に出したくない項目のための
 * 「- {label}を変更しました」の1行。変わっていなければ `null`。
 */
export function changedFlagLine(label: string, changed: boolean): string | null {
  return changed ? `- ${label}を変更しました` : null;
}
