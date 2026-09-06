import type { EventEditFormInput } from "../../domain/validation";
import { LIMITS } from "../../domain/validation";
import { FieldError } from "../components/field-error";
import { PasteTextBlock } from "../components/paste-text-block";
import { Layout } from "../layout";

export interface OrganizerPageProps {
  slug: string;
  values: EventEditFormInput;
  errors: Record<string, string>;
  /** 合言葉(平文)。主催者画面でのみ再表示する。 */
  joinCode: string;
  pasteText: string;
}

/**
 * 主催者画面(`/e/:slug/organizer`)。イベント情報の編集、募集状況の切替、
 * 合言葉の再表示、貼付文面のコピー、エクスポートへの導線をまとめる。
 */
export const OrganizerPage = ({
  slug,
  values,
  errors,
  joinCode,
  pasteText,
}: OrganizerPageProps) => (
  <Layout title="主催者設定 - bandoff" page="organizer">
    <main class="page">
      <h1>主催者設定</h1>
      <p>
        <a href={`/e/${slug}/`}>← 曲一覧に戻る</a>
      </p>

      <section class="card">
        <h2>合言葉</h2>
        <div class="copy-row">
          <p id="join-code-display" class="join-code-display">
            {joinCode}
          </p>
          <button type="button" data-copy-target="join-code-display">
            コピーする
          </button>
        </div>
      </section>

      <PasteTextBlock pasteText={pasteText} />

      <section class="card">
        <h2>エクスポート</h2>
        <p>
          <a href={`/e/${slug}/export.json`}>イベントデータをJSONでダウンロード</a>
        </p>
      </section>

      <section class="card">
        <h2>イベント情報</h2>
        <form method="post" action={`/e/${slug}/organizer/event`}>
          <div class="field">
            <label for="title">タイトル</label>
            <input
              id="title"
              type="text"
              name="title"
              value={values.title}
              maxlength={LIMITS.EVENT_TITLE_MAX}
              required
            />
            <FieldError message={errors.title} />
          </div>

          <div class="field">
            <label for="region">地域</label>
            <input
              id="region"
              type="text"
              name="region"
              value={values.region}
              maxlength={LIMITS.REGION_MAX}
              required
            />
            <FieldError message={errors.region} />
          </div>

          <div class="field">
            <label for="startsAt">開催日時</label>
            <input
              id="startsAt"
              type="datetime-local"
              name="startsAt"
              value={values.startsAt}
              required
            />
            <FieldError message={errors.startsAt} />
          </div>

          <div class="field">
            <label for="place">場所</label>
            <input
              id="place"
              type="text"
              name="place"
              value={values.place}
              maxlength={LIMITS.PLACE_MAX}
              required
            />
            <FieldError message={errors.place} />
          </div>

          <div class="field">
            <label for="notes">備考</label>
            <textarea id="notes" name="notes" maxlength={LIMITS.NOTES_MAX}>
              {values.notes}
            </textarea>
            <FieldError message={errors.notes} />
          </div>

          <div class="field">
            <label for="status">募集状況</label>
            <select id="status" name="status">
              <option value="upcoming" selected={values.status === "upcoming"}>
                募集中
              </option>
              <option value="closed" selected={values.status === "closed"}>
                締切(参加者は書き込み不可)
              </option>
            </select>
            <FieldError message={errors.status} />
          </div>

          <div class="actions">
            <button type="submit">更新する</button>
          </div>
        </form>
      </section>

      <form method="post" action={`/e/${slug}/organizer/logout`} class="inline-form">
        <button type="submit">主催者からログアウト</button>
      </form>
    </main>
  </Layout>
);
