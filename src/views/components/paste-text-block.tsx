export interface PasteTextBlockProps {
  /** 「Discordに貼る文面」(URLと合言葉をまとめたテキスト)。 */
  pasteText: string;
}

/**
 * 「Discordに貼る文面」の表示とコピーボタン。welcome ページ・主催者画面の
 * 両方から使う。コピー操作の配線は `src/client/ui.ts` の
 * `initCopyButtons()` が担当する。
 */
export const PasteTextBlock = ({ pasteText }: PasteTextBlockProps) => (
  <section class="card">
    <h2>Discordに貼る文面</h2>
    <p>URLと合言葉をまとめたものです。そのまま貼り付けられます。</p>
    <textarea id="paste-text" class="paste-text" readonly rows={5}>
      {pasteText}
    </textarea>
    <button type="button" data-copy-target="paste-text">
      コピーする
    </button>
  </section>
);
