import { Layout } from "../layout";

export interface WelcomePageProps {
  slug: string;
  /** 端末トークン(平文)。クライアント側で localStorage に保存する。 */
  token: string;
  /** 復帰キー(平文で再表示できるのはこの画面限りで、サーバーはハッシュしか保持しない)。 */
  recoveryKey: string;
  /** 「Discordに貼る文面」(URLと合言葉)。 */
  pasteText: string;
  /** エントリー結果があれば表示する(参加者登録直後、slot 指定があった場合)。 */
  entryResult?: string;
}

/**
 * イベント作成直後、および参加者登録直後の welcome ページ。
 * 復帰キーの表示・「メモしました」チェック・貼付文面のコピーは
 * `src/client/session.ts` の `initWelcomePage()` が配線する。
 */
export const WelcomePage = ({
  slug,
  token,
  recoveryKey,
  pasteText,
  entryResult,
}: WelcomePageProps) => (
  <Layout title="登録できました - bandoff" page="welcome">
    <main
      class="page"
      data-slug={slug}
      data-token={token}
      data-recovery-key={recoveryKey}
    >
      <h1>登録できました</h1>

      {entryResult ? <p class="notice">{entryResult}</p> : null}

      <section class="card">
        <h2>引き継ぎコード</h2>
        <p>
          この端末やブラウザのデータを失ったとき、別の端末からアクセスするときに必要です。
          <strong>必ずメモしてください。</strong>
          再表示は設定画面からいつでもできますが、この端末が生きている間に限ります。
        </p>
        <p class="recovery-key">{recoveryKey}</p>
      </section>

      <section class="card">
        <h2>Discordに貼る文面</h2>
        <p>URLと合言葉をまとめたものです。そのまま貼り付けられます。</p>
        <textarea id="paste-text" class="paste-text" readonly rows={4}>
          {pasteText}
        </textarea>
        <button type="button" data-action="copy-paste-text">
          コピーする
        </button>
      </section>

      <label class="checkbox-row">
        <input type="checkbox" id="memo-confirm" />
        引き継ぎコードをメモしました
      </label>

      <div class="actions">
        <button type="button" id="continue-button" disabled data-href={`/e/${slug}/`}>
          曲一覧へ進む
        </button>
      </div>
    </main>
  </Layout>
);
