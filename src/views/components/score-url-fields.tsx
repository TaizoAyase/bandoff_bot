import { LIMITS } from "../../domain/validation";
import { FieldError } from "./field-error";

export interface ScoreUrlFieldsProps {
  scoreUrls: readonly string[];
  error?: string;
}

const ScoreUrlRow = ({ url }: { url: string }) => (
  <div class="score-url-row" data-score-url-row>
    <input
      type="url"
      name="scoreUrl"
      value={url}
      maxlength={LIMITS.SCORE_URL_MAX}
      placeholder="https://..."
    />
    <button type="button" data-action="remove-score-url">
      削除
    </button>
  </div>
);

/**
 * 曲の譜面URL入力欄。ラベルは持たず、動的に行を増減できる
 * (`<template>` clone。パート構成と同じ仕組み)。登録・編集の両画面から
 * 呼ぶ共有部品で、マークアップ(特に id 群)がずれるとクライアント JS が
 * 動かなくなる。0件でも入力の起点として空行を1つ出す
 * (JS が動かない環境でも1本は入力できる)。
 *
 * 見出しが指すのは個々の入力欄ではなく行の集まりなので、`<label for>` では
 * なく `<fieldset>` + `<legend>` で出す。`<label>` は1つの入力欄しか指せず、
 * 見出しを `<span>` にすると支援技術には「譜面URL」という文脈が伝わらない
 * (入力欄に残るのは placeholder だけになる)。
 */
export const ScoreUrlFields = ({ scoreUrls, error }: ScoreUrlFieldsProps) => (
  <fieldset class="field score-url-fields">
    <legend class="field-label">譜面URL</legend>
    <FieldError message={error} />
    <div id="score-url-rows">
      {(scoreUrls.length > 0 ? scoreUrls : [""]).map((url) => (
        <ScoreUrlRow url={url} />
      ))}
    </div>
    <template id="score-url-row-template">
      <ScoreUrlRow url="" />
    </template>
    <button type="button" id="add-score-url-button">
      + 譜面URLを追加
    </button>
  </fieldset>
);
