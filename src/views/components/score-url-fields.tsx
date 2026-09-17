import type { ScoreUrlInput } from "../../domain/score-urls";
import { LIMITS } from "../../domain/validation";
import { FieldError } from "./field-error";

export interface ScoreUrlFieldsProps {
  scoreUrls: readonly ScoreUrlInput[];
  error?: string;
}

const ScoreUrlRow = ({ row }: { row: ScoreUrlInput }) => (
  <div class="score-url-row" data-score-url-row>
    <input
      type="url"
      name="scoreUrl"
      value={row.url}
      maxlength={LIMITS.SCORE_URL_MAX}
      placeholder="https://..."
      aria-label="譜面URL"
    />
    <input
      type="text"
      name="scoreUrlLabel"
      value={row.label}
      maxlength={LIMITS.SCORE_URL_LABEL_MAX}
      placeholder="名前(任意)"
      aria-label="譜面の名前(任意)"
    />
    <button type="button" data-action="remove-score-url">
      削除
    </button>
  </div>
);

/**
 * 曲の譜面URL入力欄。1行につき URL と任意の名前の2欄を持ち、動的に行を
 * 増減できる(`<template>` clone。パート構成と同じ仕組み)。登録・編集の
 * 両画面から呼ぶ共有部品で、マークアップ(特に id 群)がずれるとクライアント
 * JS が動かなくなる。0件でも入力の起点として空行を1つ出す
 * (JS が動かない環境でも1本は入力できる)。
 *
 * 見出しが指すのは個々の入力欄ではなく行の集まりなので、`<label for>` では
 * なく `<fieldset>` + `<legend>` で出す。`<label>` は1つの入力欄しか指せず、
 * 見出しを `<span>` にすると支援技術には「譜面URL」という文脈が伝わらない
 * (入力欄に残るのは placeholder だけになる)。
 *
 * そのうえで各入力欄に `aria-label` を付けているのは、1行が2欄になった今
 * `<legend>` だけでは支援技術が URL 欄と名前欄を区別できないため。行は
 * `<template>` から clone されるので `id` を振って `<label for>` で結ぶことは
 * できない(clone すると id が重複する)。前例は
 * `src/views/components/slot-list.tsx:85` の代理エントリー用 `<select>`。
 *
 * サーバー側(`src/routes/songs.ts`)は `scoreUrl` と `scoreUrlLabel` を
 * キーごとに集め、n番目同士を同じ行として組にする。この位置合わせは
 * **2つの入力欄を常に両方レンダリングし、`disabled` を付けず、片方だけ
 * `<form>` の外に出さない** ことに依存している。1つでもエントリが欠けると、
 * その行以降の URL と名前の対応が1つずつずれる。
 */
export const ScoreUrlFields = ({ scoreUrls, error }: ScoreUrlFieldsProps) => (
  <fieldset class="field score-url-fields">
    <legend class="field-label">譜面URL</legend>
    <FieldError message={error} />
    <div id="score-url-rows">
      {(scoreUrls.length > 0 ? scoreUrls : [{ url: "", label: "" }]).map((row) => (
        <ScoreUrlRow row={row} />
      ))}
    </div>
    <template id="score-url-row-template">
      <ScoreUrlRow row={{ url: "", label: "" }} />
    </template>
    <button type="button" id="add-score-url-button">
      + 譜面URLを追加
    </button>
  </fieldset>
);
