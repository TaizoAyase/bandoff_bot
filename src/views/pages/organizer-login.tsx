import { FieldError } from "../components/field-error";
import { Layout } from "../layout";

export interface OrganizerLoginPageProps {
  slug: string;
  error?: string;
}

/** 主催者パスワード入力画面(`/e/:slug/organizer/login`)。 */
export const OrganizerLoginPage = ({ slug, error }: OrganizerLoginPageProps) => (
  <Layout title="主催者ログイン - bandoff" page="organizer-login">
    <main class="page">
      <h1>主催者パスワードを入力してください</h1>
      <form method="post" action={`/e/${slug}/organizer/login`}>
        <div class="field">
          <label for="password">主催者パスワード</label>
          <input
            id="password"
            type="password"
            name="password"
            autocomplete="off"
            required
          />
          <FieldError message={error} />
        </div>
        <div class="actions">
          <button type="submit">ログイン</button>
        </div>
      </form>
      <p>
        <a href={`/e/${slug}/`}>← 曲一覧に戻る</a>
      </p>
    </main>
  </Layout>
);
