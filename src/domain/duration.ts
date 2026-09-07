/**
 * イベントの所要時間(長さ)の選択肢。DB にもリクエストにも触れない純粋関数・定数。
 * 選択肢は30分刻みで30分〜6時間、そのあと7時間・8時間。未設定(null)は
 * select の空文字("")に対応する。
 */

import { formatDurationMinutes } from "./time";

/** select に許可する長さの値(分)の一覧。改竄された値を弾く許可リストとしても使う。 */
export const DURATION_MINUTES_OPTIONS: readonly number[] = [
  30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 420, 480,
];

/** 新規作成フォームの初期選択(3時間)。 */
export const DEFAULT_DURATION_MINUTES = 180;

export interface DurationOption {
  minutes: number;
  label: string;
}

/** 表示用の選択肢一覧(値+ラベル)。 */
export const DURATION_OPTIONS: DurationOption[] = DURATION_MINUTES_OPTIONS.map(
  (minutes) => ({ minutes, label: formatDurationMinutes(minutes) }),
);
