/**
 * 開始時刻(`<select>`)の選択肢。DB にもリクエストにも触れない純粋関数・定数。
 *
 * 以前は `<input type="datetime-local" step="900">` を使っていたが、`step` は
 * スピナーの刻みと送信時の検証にしか効かず、テキスト欄には任意の時刻
 * (例: 19:07)が入力できてしまっていた。選択肢にない時刻を物理的に
 * 入力できないよう、15分刻み(00:00〜23:45)96択の `<select>` に置き換える。
 */

/** select に許可する開始時刻の値一覧(`HH:MM`)。改竄された値を弾く許可リストとしても使う。 */
export const STARTS_TIME_OPTIONS: readonly string[] = buildOptionValues();

/** 新規作成フォームの初期選択。スタジオオフ会の典型的な開始時刻。 */
export const DEFAULT_STARTS_TIME = "19:00";

export interface StartsTimeOption {
  value: string;
  label: string;
}

/**
 * 開始時刻 `<select>` 用の表示選択肢を組み立てる。
 *
 * `currentValue` が96択の許可リストに無い場合(`datetime-local` 時代に
 * 作られたイベントの開始時刻が15分刻みでない、例: 19:07)、その実際の値を
 * 選択肢の先頭に追加し選択状態にする。これを省くと、一致する `<option>` が
 * 無いためブラウザは先頭の `00:00` を選択状態にしてしまい、主催者が他の
 * 項目だけ直して更新すると開始時刻が無警告で 00:00 に書き換わってしまう
 * (詳しくは docs/development.md の「変更するときに壊してはいけない設計」を参照)。
 * サーバー側の許可リスト(`validateStartsTime`)は96個のままなので、
 * この追加された選択肢を選び直さずに送信すると検証エラーになる。
 */
export function buildStartsTimeOptions(currentValue: string): StartsTimeOption[] {
  const base = STARTS_TIME_OPTIONS.map((value) => ({ value, label: value }));
  if (STARTS_TIME_OPTIONS.includes(currentValue)) {
    return base;
  }
  return [
    { value: currentValue, label: `${currentValue}(15分刻みではありません)` },
    ...base,
  ];
}

function buildOptionValues(): string[] {
  const values: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of [0, 15, 30, 45]) {
      values.push(`${pad2(hour)}:${pad2(minute)}`);
    }
  }
  return values;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
