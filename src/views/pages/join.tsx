import { FieldError } from "../components/field-error";
import { Layout } from "../layout";

export interface JoinPageProps {
  slug: string;
  error?: string;
}

/**
 * 合言葉入力画面。**イベント名を一切出さない**(URLだけ漏れた場合の
 * 情報露出を防ぐため)。タイトルも汎用のまま。
 */
export const JoinPage = ({ slug, error }: JoinPageProps) => (
  <Layout title="合言葉を入力 - bandoff" page="join">
    <main class="page">
      <h1>合言葉を入力してください</h1>
      <form method="post" action={`/e/${slug}/join`}>
        <div class="field">
          <label for="joinCode">合言葉</label>
          <input
            id="joinCode"
            type="password"
            name="joinCode"
            autocomplete="off"
            required
          />
          <FieldError message={error} />
        </div>
        <div class="actions">
          <button type="submit">入る</button>
        </div>
      </form>
    </main>
  </Layout>
);
