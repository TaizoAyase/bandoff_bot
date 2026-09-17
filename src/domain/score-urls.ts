/**
 * 譜面URLとその任意の名前を、フォーム・DB・表示の3つの層の間で受け渡すための
 * 型と純粋関数。名前が無いときに `譜面N` と出す表示ルールの唯一の置き場所でも
 * ある。DB には触れないので `src/db/` からは import しない。
 */

/** フォーム由来の1件。`label` の "" は「名前なし」を表す。 */
export interface ScoreUrlInput {
  url: string;
  label: string;
}

/** DB から読んだ1件。`label` の null は「名前なし」を表す。 */
export interface ScoreUrlNode {
  url: string;
  label: string | null;
}

/** 曲カードに出す1リンク。`text` が最終的な表示文字列。 */
export interface ScoreUrlLink {
  url: string;
  text: string;
}

/**
 * 同名フィールドで届いた譜面URLと名前を、位置で1行ずつの組に戻す。
 *
 * 位置で組にしてよい理由: フォームは1行につき `scoreUrl` と `scoreUrlLabel` を
 * 1つずつレンダリングし、HTML の form submission は送信可能な要素を tree order
 * で走査してエントリを作る。したがってキーごとに見れば n 番目同士が同じ行に
 * 対応することが仕様で保証される。値が空の `<input>` もエントリになるため、
 * 要素数と行数も一致する。
 *
 * 長さが食い違う壊れた POST でも throw せず、短い側を `""` で埋める。手で組んだ
 * POST や、片方のフィールドしか持たない古いタブからの POST で 500 にしないため。
 * 埋めた結果おかしい行(URLが空で名前だけある等)は検証側で弾く。
 */
export function zipScoreUrlRows(
  urls: readonly string[],
  labels: readonly string[],
): ScoreUrlInput[] {
  const rows: ScoreUrlInput[] = [];
  const length = Math.max(urls.length, labels.length);
  for (let i = 0; i < length; i += 1) {
    rows.push({ url: urls[i] ?? "", label: labels[i] ?? "" });
  }
  return rows;
}

/**
 * DB から読んだ行をフォームに載せる形へ移す。`label` の `null`(名前なし)を
 * `""` に寄せるだけ。`src/routes/songs.ts` が `context.artist ?? ""` で
 * やっているのと同じ役割で、DB 層の `null` とフォーム層の `""` の非対称を
 * ルート層で吸収する。
 */
export function toScoreUrlInputs(nodes: readonly ScoreUrlNode[]): ScoreUrlInput[] {
  return nodes.map((node) => ({ url: node.url, label: node.label ?? "" }));
}

/**
 * 曲カードに出す譜面リンクを組み立てる。表示ルールの唯一の実装。
 *
 * 決定した表示ルール: 名前があれば名前だけを出す。無ければ従来どおり
 * `譜面{通し番号}`。通し番号は名前付きの行も含めた全体の位置なので、混在時は
 * `譜面1` / `ギター` / `譜面3` のように飛ぶ。
 *
 * 表示文字列の配列ではなく `{ url, text }` の組を返すのは、`noUncheckedIndexedAccess:
 * true` のもとで並列配列を突き合わせると、呼び出し側(`src/views/components/song-card.tsx`)
 * に `texts[i] ?? ...` のフォールバックが必要になり、表示ルールが2箇所に散るため。
 *
 * 引数は DB 由来(`ScoreUrlNode`・名前なしが `null`)でもフォーム由来
 * (`ScoreUrlInput`・名前なしが `""`)でもそのまま渡せる。`label: string` は
 * `string | null` に代入でき `readonly` 配列は共変なので、キャストは要らない。
 */
export function buildScoreUrlLinks(items: readonly ScoreUrlNode[]): ScoreUrlLink[] {
  return items.map((item, index) => ({
    url: item.url,
    text: item.label === null || item.label === "" ? `譜面${index + 1}` : item.label,
  }));
}
