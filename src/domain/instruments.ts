/**
 * 楽器名まわりの純粋関数。定義済み楽器・初期枠構成・自動採番・正規化。
 */

export const PRESET_INSTRUMENTS = ["Gt", "Ba", "Dr", "Vo", "Key", "Cho"] as const;

export const DEFAULT_SLOTS = ["Gt", "Gt", "Ba", "Dr", "Vo"] as const;

const INSTRUMENT_NAME_MAX_LENGTH = 20;

/**
 * 同じ楽器名(完全一致)が複数あるとき `Gt1` `Gt2` のように連番を振る。
 * 1つしかない楽器には番号を付けない。並び順(sort_order 順)は維持する。
 */
export function numberInstruments(instruments: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const instrument of instruments) {
    counts.set(instrument, (counts.get(instrument) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return instruments.map((instrument) => {
    const total = counts.get(instrument) ?? 0;
    if (total <= 1) {
      return instrument;
    }
    const next = (seen.get(instrument) ?? 0) + 1;
    seen.set(instrument, next);
    return `${instrument}${next}`;
  });
}

// 半角カンマに加え、日本語入力で紛れやすい全角カンマ(、/，)も区切りとして扱う。
const INSTRUMENTS_INPUT_SEPARATOR = /[,、，]/;

/**
 * 改行を含む C0 制御文字全般を半角スペースに置換する。この関数を通すのは
 * `<input type="text">` の持ち込み楽器欄(カンマ区切りの単一行フィールド)
 * のみで、改行を保持すべきフィールドには使わない。改行を残すと、Discord
 * 通知本文(1件1行のプレーンテキスト、`src/domain/notify-message.ts`
 * 参照)に埋め込んだときに偽の通知行を作れてしまうため、DB に保存する
 * 値そのものから落としておく。
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字そのものを検出して潰すための意図的な正規表現。
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/g;

function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHAR_PATTERN, " ");
}

/**
 * カンマ区切りの自由入力(例: `"Gt, Ba"` `"Gt、Ba"`)を配列に分解し、正規化する。
 * フォームの1テキスト入力から持ち込み楽器のリストを受け取るときに使う。
 */
export function parseInstrumentsInput(value: string): string[] {
  return normalizeInstruments(value.split(INSTRUMENTS_INPUT_SEPARATOR));
}

/**
 * 持ち込み楽器の自由入力リストを正規化する。
 * 前後空白除去・空要素除去・重複除去(完全一致)を行い、各要素は20文字までに切り詰める。
 */
export function normalizeInstruments(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of list) {
    const trimmed = stripControlChars(raw).trim().slice(0, INSTRUMENT_NAME_MAX_LENGTH);
    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
