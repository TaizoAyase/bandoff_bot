import { PasteTextBlock } from "../components/paste-text-block";
import { Layout } from "../layout";

export interface WelcomePageProps {
  slug: string;
  /** 端末トークン(平文)。クライアント側で localStorage に保存する。 */
  token: string;
  /** 引き継ぎコード(平文で再表示できるのはこの画面限りで、サーバーはハッシュしか保持しない)。 */
  recoveryKey: string;
  /** 「Discordに貼る文面」(URLと合言葉)。 */
  pasteText: string;
  /** エントリー結果があれば表示する(参加者登録直後、slot 指定があった場合)。 */
  entryResult?: string;
  /**
   * 主催者キー(平文)。イベント作成直後のみ渡される
   * (参加者登録・引き継ぎコード復旧の経路では渡さない)。
   */
  organizerKey?: string;
}

/**
 * イベント作成直後、および参加者登録直後の welcome ページ。
 * 引き継ぎコード・主催者キーの表示・「メモしました」チェック・貼付文面の
 * コピーは `src/client/session.ts` の `initWelcomePage()` が配線する。
 */
export const WelcomePage = ({
  slug,
  token,
  recoveryKey,
  pasteText,
  entryResult,
  organizerKey,
}: WelcomePageProps) => (
  <Layout title="登録できました - bandoff" page="welcome">
    <main
      class="page"
      data-slug={slug}
      data-token={token}
      data-recovery-key={recoveryKey}
      data-organizer-key={organizerKey}
    >
      <h1>登録できました</h1>

      {entryResult ? <p class="notice">{entryResult}</p> : null}

      {organizerKey ? (
        <section class="card">
          <h2>主催者キー</h2>
          <p>主催者画面に入るときと、他の人に主催者権限を渡すときに使います。</p>
          <div class="copy-row">
            <p class="recovery-key" id="organizer-key">
              {organizerKey}
            </p>
            <button type="button" data-copy-target="organizer-key">
              コピーする
            </button>
          </div>
        </section>
      ) : null}

      <section class="card">
        <h2>引き継ぎコード</h2>
        <p>
          この端末やブラウザのデータを失ったとき、別の端末からアクセスするときに必要です。
          <strong>必ずメモしてください。</strong>
          再表示は設定画面からいつでもできますが、この端末が生きている間に限ります。
        </p>
        <div class="copy-row">
          <p class="recovery-key" id="recovery-key">
            {recoveryKey}
          </p>
          <button type="button" data-copy-target="recovery-key">
            コピーする
          </button>
        </div>
      </section>

      <PasteTextBlock pasteText={pasteText} />

      <label class="checkbox-row">
        <input type="checkbox" id="memo-confirm" />
        {organizerKey
          ? "引き継ぎコードと主催者キーをメモしました"
          : "引き継ぎコードをメモしました"}
      </label>

      <div class="actions">
        <button type="button" id="continue-button" disabled data-href={`/e/${slug}/`}>
          曲一覧へ進む
        </button>
      </div>
    </main>
  </Layout>
);
