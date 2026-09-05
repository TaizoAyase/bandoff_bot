import { FieldError } from "../components/field-error";
import { Layout } from "../layout";

export interface RecoverPageProps {
  slug: string;
  error?: string;
}

/**
 * 復帰キーによる復旧画面(`/e/:slug/recover`)。別端末からのアクセスや
 * localStorage 喪失時の救済手段(仕様 8.1)。
 */
export const RecoverPage = ({ slug, error }: RecoverPageProps) => (
  <Layout title="復帰キーで引き継ぐ - bandoff" page="recover">
    <main class="page">
      <h1>復帰キーで引き継ぐ</h1>
      <p>
        別の端末で登録済みの場合、発行された復帰キー(引き継ぎコード)を入力してください。
      </p>
      <form method="post" action={`/e/${slug}/recover`}>
        <div class="field">
          <label for="recoveryKey">復帰キー</label>
          <input
            id="recoveryKey"
            type="text"
            name="recoveryKey"
            autocomplete="off"
            placeholder="XXXX-XXXX-XXXX"
            required
          />
          <FieldError message={error} />
        </div>
        <div class="actions">
          <button type="submit">引き継ぐ</button>
        </div>
      </form>
      <p>
        <a href={`/e/${slug}/`}>← 曲一覧に戻る</a>
      </p>
    </main>
  </Layout>
);
