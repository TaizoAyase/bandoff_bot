import { LIMITS } from "../../domain/validation";
import { FieldError } from "../components/field-error";
import { Layout } from "../layout";

export interface RegisterPageProps {
  slug: string;
  /** join しようとしていた枠の id(あれば)。登録完了後に同一リクエストでエントリーする。 */
  slot: string;
  values: { displayName: string };
  /** カンマ区切りの持ち込み楽器の生入力。 */
  instruments: string;
  errors: Record<string, string>;
  /** 表示名が完全一致する既存参加者がいるときの警告文。無ければ null。 */
  duplicateWarning: string | null;
}

/** 参加者登録フォーム(`/e/:slug/register`)。 */
export const RegisterPage = ({
  slug,
  slot,
  values,
  instruments,
  errors,
  duplicateWarning,
}: RegisterPageProps) => (
  <Layout title="参加者登録 - bandoff" page="register">
    <main class="page">
      <h1>参加者登録</h1>
      <p>
        <a href={`/e/${slug}/`}>← 曲一覧に戻る</a>
      </p>

      {duplicateWarning ? (
        <p class="notice notice-warning">{duplicateWarning}</p>
      ) : null}

      <form method="post" action={`/e/${slug}/participants`}>
        <input type="hidden" name="slot" value={slot} />
        {duplicateWarning ? <input type="hidden" name="confirm" value="1" /> : null}

        <div class="field">
          <label for="displayName">表示名</label>
          <input
            id="displayName"
            type="text"
            name="displayName"
            value={values.displayName}
            maxlength={LIMITS.DISPLAY_NAME_MAX}
            required
          />
          <FieldError message={errors.displayName} />
        </div>

        <div class="field">
          <label for="instruments">持ち込み楽器</label>
          <input
            id="instruments"
            type="text"
            name="instruments"
            value={instruments}
            placeholder="例: Gt, Ba"
          />
        </div>

        <div class="actions">
          <button type="submit">
            {duplicateWarning ? "このまま登録する" : "登録する"}
          </button>
        </div>
      </form>
    </main>
  </Layout>
);
