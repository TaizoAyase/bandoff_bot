import { Layout } from "../layout";

export interface TakenPageProps {
  slug: string;
}

/**
 * 条件付き INSERT が0行だった(既に他の人が入っていた)ときの応答。
 * 仕様 9.5「挿入行数が0なら『先を越されました』を返す」。
 */
export const TakenPage = ({ slug }: TakenPageProps) => (
  <Layout title="先を越されました - bandoff" page="taken">
    <main class="page">
      <h1>先を越されました</h1>
      <p>この枠には、たった今別の人が入りました。</p>
      <p>
        <a href={`/e/${slug}/`}>曲一覧に戻る</a>
      </p>
    </main>
  </Layout>
);
