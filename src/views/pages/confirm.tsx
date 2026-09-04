import { Layout } from "../layout";

export interface ConfirmJoinPageProps {
  slug: string;
  slotId: string;
  message: string;
}

/**
 * 同じ Take 内に既に別の Assignment を持つ人が、もう1つの枠に入ろうと
 * したときの確認画面(仕様 227〜235行目)。警告は出すが禁止しない。
 * `confirm=1` を付けて同じエントリー先へ再送信すると確定する。
 */
export const ConfirmJoinPage = ({ slug, slotId, message }: ConfirmJoinPageProps) => (
  <Layout title="確認 - bandoff" page="confirm">
    <main class="page">
      <h1>確認</h1>
      <p>{message}</p>
      <form method="post" action={`/e/${slug}/slots/${slotId}/join`}>
        <input type="hidden" name="confirm" value="1" />
        <div class="actions">
          <button type="submit">それでもエントリーする</button>
        </div>
      </form>
      <p>
        <a href={`/e/${slug}/`}>やめて曲一覧に戻る</a>
      </p>
    </main>
  </Layout>
);
