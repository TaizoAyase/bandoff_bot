import { LIMITS, type NewEventFormInput } from "../../domain/validation";
import { FieldError } from "../components/field-error";
import { Layout } from "../layout";

export interface NewEventPageProps {
  values: NewEventFormInput;
  /** カンマ区切りの持ち込み楽器の生入力。 */
  instruments: string;
  errors: Record<string, string>;
}

export const emptyNewEventFormValues: NewEventFormInput = {
  title: "",
  region: "",
  startsAt: "",
  place: "",
  notes: "",
  joinCode: "",
  organizerPassword: "",
  organizerDisplayName: "",
};

/** `/new` のイベント作成フォーム。 */
export const NewEventPage = ({ values, instruments, errors }: NewEventPageProps) => (
  <Layout title="イベントを作る - bandoff" page="new-event">
    <main class="page">
      <h1>イベントを作る</h1>
      <form method="post" action="/new">
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
            placeholder="例: 東京"
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

        <hr />

        <div class="field">
          <label for="organizerDisplayName">あなたの表示名(主催者)</label>
          <input
            id="organizerDisplayName"
            type="text"
            name="organizerDisplayName"
            value={values.organizerDisplayName}
            maxlength={LIMITS.DISPLAY_NAME_MAX}
            required
          />
          <FieldError message={errors.organizerDisplayName} />
        </div>

        <div class="field">
          <label for="organizerInstruments">あなたの持ち込み楽器</label>
          <input
            id="organizerInstruments"
            type="text"
            name="organizerInstruments"
            value={instruments}
            placeholder="例: Gt, Ba"
          />
        </div>

        <hr />

        <div class="field">
          <label for="joinCode">合言葉(参加者に共有します)</label>
          <input
            id="joinCode"
            type="text"
            name="joinCode"
            value={values.joinCode}
            maxlength={LIMITS.JOIN_CODE_MAX}
            required
          />
          <FieldError message={errors.joinCode} />
        </div>

        <div class="field">
          <label for="organizerPassword">主催者パスワード(編集・代理操作用)</label>
          <input
            id="organizerPassword"
            type="password"
            name="organizerPassword"
            maxlength={LIMITS.ORGANIZER_PASSWORD_MAX}
            required
          />
          <FieldError message={errors.organizerPassword} />
        </div>

        <div class="actions">
          <button type="submit">作成する</button>
        </div>
      </form>
    </main>
  </Layout>
);
