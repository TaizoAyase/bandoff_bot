import { LIMITS } from "../../domain/validation";
import { FieldError } from "../components/field-error";
import { Layout } from "../layout";

export interface SettingsPageProps {
  slug: string;
  isParticipant: boolean;
  values: { displayName: string };
  /** カンマ区切りの持ち込み楽器の生入力。 */
  instruments: string;
  errors: Record<string, string>;
  /** 表示名が完全一致する既存参加者がいるときの警告文。無ければ null。 */
  duplicateWarning: string | null;
  /** プロフィール更新直後の通知を出すか。 */
  updated?: boolean;
}

/**
 * 設定画面(`/e/:slug/settings`)。引き継ぎコードの再表示は
 * `src/client/ui.ts` の `initSettingsPage()` が localStorage から読んで
 * `#recovery-key-display` に差し込む(サーバーは平文の引き継ぎコードを持たない)。
 */
export const SettingsPage = ({
  slug,
  isParticipant,
  values,
  instruments,
  errors,
  duplicateWarning,
  updated,
}: SettingsPageProps) => (
  <Layout title="設定 - bandoff" page="settings">
    <main class="page" data-slug={slug}>
      <h1>設定</h1>
      <p>
        <a href={`/e/${slug}/`}>← 曲一覧に戻る</a>
      </p>

      {updated ? <p class="notice">更新しました</p> : null}

      <section class="card">
        <h2>引き継ぎコード</h2>
        <div class="copy-row">
          <p id="recovery-key-display" class="recovery-key">
            この端末で確認中です…
          </p>
          <button type="button" data-copy-target="recovery-key-display">
            コピーする
          </button>
        </div>
        <p>
          この端末に保存されていない場合は、
          <a href={`/e/${slug}/recover`}>引き継ぎコードで引き継ぐ</a>
          を使ってください。
        </p>
      </section>

      {isParticipant ? (
        <>
          <section class="card">
            <h2>プロフィール</h2>
            {duplicateWarning ? (
              <p class="notice notice-warning">{duplicateWarning}</p>
            ) : null}
            <form method="post" action={`/e/${slug}/settings/profile`}>
              {duplicateWarning ? (
                <input type="hidden" name="confirm" value="1" />
              ) : null}
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
                <button type="submit">保存する</button>
              </div>
            </form>
          </section>

          <section class="card">
            <h2>この端末の紐付けを解除</h2>
            <p>
              この端末に保存されている登録情報を解除します。合言葉から入り直すか、
              引き継ぎコードで再度紐付けるまで、参加者としての操作はできなくなります。
            </p>
            <form
              method="post"
              action={`/e/${slug}/settings/unbind`}
              data-action="unbind-device"
            >
              <button type="submit">紐付けを解除する</button>
            </form>
          </section>
        </>
      ) : (
        <p class="notice">参加登録すると、表示名や持ち込み楽器を編集できます。</p>
      )}
    </main>
  </Layout>
);
