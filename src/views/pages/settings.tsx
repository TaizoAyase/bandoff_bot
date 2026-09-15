import type { MyAssignmentItem } from "../../db/queries/songs";
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
  /**
   * 表示中の participant が主催者本人の Participant か。true なら
   * 「参加を取りやめる」ボタンの代わりに保護メッセージを出す
   * (`isParticipant` が false のときは無視される)。
   */
  isOrganizersOwnParticipant: boolean;
  /**
   * 参加を取りやめたときに一緒に消える全エントリー(確認ダイアログの
   * 文言に使う。主催者の一括辞退と同じ見せ方)。`isParticipant` が
   * false、または `isOrganizersOwnParticipant` のときは空配列でよい。
   */
  withdrawEntries: MyAssignmentItem[];
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
  isOrganizersOwnParticipant,
  withdrawEntries,
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
              主催者権限を持っていた場合はそれも失われるため、再度必要なときは
              主催者キーで入力し直してください。
            </p>
            <form
              method="post"
              action={`/e/${slug}/settings/unbind`}
              data-action="unbind-device"
            >
              <button type="submit">紐付けを解除する</button>
            </form>
          </section>

          <section class="card">
            <h2>参加の取りやめ</h2>
            {isOrganizersOwnParticipant ? (
              <p class="notice">主催者は参加を取りやめられません</p>
            ) : (
              <>
                <p>
                  このオフ会への参加を取りやめます。参加し直すには、もう一度
                  参加登録が必要です(以前の登録・エントリーには戻せません)。
                </p>
                <form
                  method="post"
                  action={`/e/${slug}/settings/withdraw`}
                  data-confirm={
                    withdrawEntries.length > 0
                      ? `参加を取りやめます。全エントリー(${withdrawEntries
                          .map((entry) => `${entry.songTitle}: ${entry.slotLabel}`)
                          .join("、")})も辞退します`
                      : "参加を取りやめます"
                  }
                >
                  <button type="submit">参加を取りやめる</button>
                </form>
              </>
            )}
          </section>
        </>
      ) : (
        <p class="notice">参加登録すると、表示名や持ち込み楽器を編集できます。</p>
      )}
    </main>
  </Layout>
);
