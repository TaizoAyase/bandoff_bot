/**
 * Discord Interactions の応答本文・ボタンの組み立て(計画4-4〜4-5)。
 * env / DB / fetch には一切触れない純粋関数のみを置く
 * (`notify-text.ts`/`notify-event.ts` と同じ方針)。
 */

import { escapeMarkdown, truncate } from "./notify-text";
import { formatJst, formatJstShort } from "./time";
import { LIMITS } from "./validation";

/** オートコンプリート候補 `name` の上限(Discord API の制約)。 */
const CANDIDATE_NAME_MAX_LENGTH = 100;
/** `/bandoff list` のボタン `label` の上限(Discord API の制約)。 */
const LIST_BUTTON_LABEL_MAX_LENGTH = 80;
/** 1行に並べるボタンの最大数(Discord API の制約: 1 Action Row = 5個まで)。 */
const BUTTONS_PER_ROW = 5;

/** 高位サロゲート(サロゲートペアの上位側)の範囲。 */
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

/**
 * `maxLength` 文字(UTF-16 コードユニット)に切り詰める。省略記号は付けない
 * (`notify-text.ts` の `truncate` は本文全体を2000文字に切り詰めて
 * `…(以下省略)` を付ける用途のため、100/80文字のラベル用には使えない)。
 * サロゲートペアの境界で孤立した高位サロゲートを作らないよう、必要なら
 * さらに1コードユニット落とす。
 */
function truncateLabel(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  let cutLength = maxLength;
  const boundaryCode = text.charCodeAt(cutLength - 1);
  if (boundaryCode >= HIGH_SURROGATE_MIN && boundaryCode <= HIGH_SURROGATE_MAX) {
    cutLength -= 1;
  }
  return text.slice(0, cutLength);
}

export interface CandidateEventInput {
  /** イベント ID(候補の `value` に使う。slug は Discord に渡さない)。 */
  id: string;
  title: string;
  region: string;
  startsAt: number;
}

/**
 * `/bandoff open` のオートコンプリート候補の `name`(計画4-4)。
 * `{M/D(曜) HH:MM} {イベント名}({地域})` の形にし、100文字に切り詰める。
 * イベント名・地域はユーザー入力のため `escapeMarkdown` で無害化する
 * (計画10章「候補の名前・一覧本文…Markdown 記号と改行の無害化」)。
 */
export function buildCandidateName(input: CandidateEventInput): string {
  const period = formatJstShort(input.startsAt);
  const title = escapeMarkdown(input.title);
  const region = escapeMarkdown(input.region);
  return truncateLabel(`${period} ${title}(${region})`, CANDIDATE_NAME_MAX_LENGTH);
}

export interface DisplayNameHintInput {
  /** サーバーのニックネーム。未設定なら `null`。 */
  nick: string | null;
  /** グローバル表示名。未設定なら `null`。 */
  globalName: string | null;
  /** ユーザー名。 */
  username: string | null;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字そのものを検出して潰すための意図的な正規表現。
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/g;

function normalizeHint(value: string): string {
  return value.replace(CONTROL_CHAR_PATTERN, " ").trim();
}

/**
 * 登録時の表示名の初期値(計画4-4)。サーバーのニックネーム → グローバル
 * 表示名 → ユーザー名の順で、正規化(制御文字除去・trim)した結果が空でない
 * 最初のものを採用する。`DISPLAY_NAME_MAX`(30)に切り詰める。すべて空なら
 * 空文字を返す。
 */
export function buildDisplayNameHint(input: DisplayNameHintInput): string {
  for (const raw of [input.nick, input.globalName, input.username]) {
    if (raw === null) continue;
    const normalized = normalizeHint(raw);
    if (normalized !== "") {
      return truncateLabel(normalized, LIMITS.DISPLAY_NAME_MAX);
    }
  }
  return "";
}

export interface DiscordButtonComponent {
  type: 2;
  style: 1 | 5;
  label: string;
  custom_id?: string;
  url?: string;
}

export interface DiscordActionRow {
  type: 1;
  components: DiscordButtonComponent[];
}

export interface OpenLinkMessage {
  content: string;
  components: DiscordActionRow[];
}

/**
 * `/bandoff open` 実行・`/bandoff list` のボタン押下で返す、1回限りの
 * リンクの案内メッセージ(計画4-4)。
 */
export function buildOpenLinkMessage(input: {
  eventTitle: string;
  url: string;
}): OpenLinkMessage {
  const title = escapeMarkdown(input.eventTitle);
  return {
    content: `〔${title}〕を開くリンクです。10分間・1回だけ有効です。他の人に渡さないでください`,
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 5, label: "開く", url: input.url }],
      },
    ],
  };
}

/** `/bandoff new` の案内メッセージ(計画4-4)。作成者の自動紐付けは範囲外。 */
export function buildNewCommandMessage(newEventUrl: string): OpenLinkMessage {
  return {
    content: "新しいオフ会を作成するページです",
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 5, label: "作成する", url: newEventUrl }],
      },
    ],
  };
}

export interface ListEventInput {
  id: string;
  title: string;
  region: string;
  place: string;
  startsAt: number;
  /** 実行者の Discord ID が紐付いた参加中の participant がいるか。 */
  joined: boolean;
}

const NO_CANDIDATES_MESSAGE = "Discord から開けるイベントはありません";

function buildListItemBlock(input: ListEventInput): string {
  const title = escapeMarkdown(input.title);
  const joinedSuffix = input.joined ? " (参加中)" : "";
  const detailParts = [input.region, formatJst(input.startsAt), input.place]
    .filter((value) => value !== "")
    .map((value) => escapeMarkdown(value));
  const detailLine = detailParts.length > 0 ? `\n${detailParts.join("・")}` : "";
  return `**${title}**${joinedSuffix}${detailLine}`;
}

/**
 * `/bandoff list` の本文(計画4-4)。0件なら固定文言を返す。
 * 全体をさらに2000文字に切り詰める(Discord の `content` の上限)。
 */
export function buildListBody(items: ListEventInput[]): string {
  if (items.length === 0) {
    return NO_CANDIDATES_MESSAGE;
  }
  return truncate(items.map((item) => buildListItemBlock(item)).join("\n\n"));
}

/**
 * `/bandoff list` のボタン(計画4-4)。イベントごとに1つ、5個ずつ最大5行。
 * `custom_id` は `open:{イベントID}`。
 */
export function buildListActionRows(
  items: { id: string; title: string }[],
): DiscordActionRow[] {
  const buttons: DiscordButtonComponent[] = items.map((item) => ({
    type: 2,
    style: 1,
    label: truncateLabel(escapeMarkdown(item.title), LIST_BUTTON_LABEL_MAX_LENGTH),
    custom_id: `open:${item.id}`,
  }));
  const rows: DiscordActionRow[] = [];
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    rows.push({ type: 1, components: buttons.slice(i, i + BUTTONS_PER_ROW) });
  }
  return rows;
}

const OPEN_CUSTOM_ID_PREFIX = "open:";

/**
 * `/bandoff list` のボタンの `custom_id`(`open:{イベントID}`)からイベント
 * ID を取り出す。プレフィックス不一致・ID 部分が空なら `null`。
 */
export function parseOpenCustomId(customId: string): string | null {
  if (!customId.startsWith(OPEN_CUSTOM_ID_PREFIX)) {
    return null;
  }
  const id = customId.slice(OPEN_CUSTOM_ID_PREFIX.length);
  return id === "" ? null : id;
}
