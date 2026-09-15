import { Layout } from "../layout";

export interface WithdrawnPageProps {
  slug: string;
}

/**
 * 参加取りやめ完了ページ(`POST /e/:slug/settings/withdraw` の応答を
 * 200 でそのまま返す。リダイレクトにしない理由は計画5-1参照)。
 * `src/client/session.ts` の `initWithdrawnPage()` が、この画面の表示だけを
 * トリガーに端末トークン・引き継ぎコードを localStorage から消す
 * (主催者キーは消さない。共同主催者の主催者権限は別物のため)。
 */
export const WithdrawnPage = ({ slug }: WithdrawnPageProps) => (
  <Layout title="参加を取りやめました - bandoff" page="withdrawn">
    <main class="page" data-slug={slug}>
      <h1>参加を取りやめました</h1>
      <p>
        このオフ会の参加登録と全エントリーを取りやめました。参加し直すには、
        もう一度参加登録が必要です(以前の登録・エントリーには戻せません)。
      </p>
      <p>
        <a href={`/e/${slug}/`}>← 曲一覧に戻る</a>
      </p>
    </main>
  </Layout>
);
