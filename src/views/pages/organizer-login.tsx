import { FieldError } from "../components/field-error";
import { Layout } from "../layout";

export interface OrganizerLoginPageProps {
  slug: string;
  error?: string;
}

/** 主催者キー入力画面(`/e/:slug/organizer/login`)。 */
export const OrganizerLoginPage = ({ slug, error }: OrganizerLoginPageProps) => (
  <Layout title="主催者ログイン - bandoff" page="organizer-login">
    <main class="page">
      <h1>主催者キーを入力してください</h1>
      <form method="post" action={`/e/${slug}/organizer/login`}>
        <div class="field">
          <label for="organizerKey">主催者キー</label>
          <input
            id="organizerKey"
            type="text"
            name="organizerKey"
            autocomplete="off"
            placeholder="XXXX-XXXX-XXXX"
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
