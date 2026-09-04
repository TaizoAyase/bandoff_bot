import { Layout } from "../layout";

/** `/` の最小案内ページ。「イベントを作る」リンクのみを出す。 */
export const HomePage = () => (
  <Layout title="bandoff" page="home">
    <main class="page">
      <h1>bandoff</h1>
      <p>
        <a href="/new">イベントを作る</a>
      </p>
    </main>
  </Layout>
);
