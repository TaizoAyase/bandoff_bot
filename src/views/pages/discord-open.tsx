import { Layout } from "../layout";

export interface DiscordOpenPageProps {
  slug: string;
}

/**
 * Discord の `/bandoff open` から届いたリンクの着地ページ
 * (`GET /e/:slug/discord`、計画5-2)。トークンは URL のフラグメントに
 * 入っているためサーバーには渡らず、`src/client/discord.ts` が
 * `location.hash` から読んで `POST` で消費する。cookie が無くても表示する
 * (ガードを付けない)。
 */
export const DiscordOpenPage = ({ slug }: DiscordOpenPageProps) => (
  <Layout title="開いています... - bandoff" page="discord-open">
    <main class="page" data-slug={slug}>
      <h1>開いています…</h1>
      <p>少し待つと自動的に移動します。</p>
      <p id="discord-open-error" class="notice notice-warning" hidden>
        リンクが無効か期限切れです。Discord でもう一度 /bandoff open を実行してください
      </p>
      <noscript>
        <p class="notice notice-warning">JavaScript を有効にしてください</p>
      </noscript>
    </main>
  </Layout>
);
