import { DEFAULT_DURATION_MINUTES, DURATION_OPTIONS } from "../../domain/duration";
import { buildStartsTimeOptions, DEFAULT_STARTS_TIME } from "../../domain/starts-time";
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
  startsDate: "",
  startsTime: DEFAULT_STARTS_TIME,
  durationMinutes: String(DEFAULT_DURATION_MINUTES),
  place: "",
  notes: "",
  joinCode: "",
  organizerDisplayName: "",
  // 新規イベントは既定でオン(計画のユーザー決定事項)。
  discordEnabled: true,
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
          <label for="startsDate">開催日</label>
          <input
            id="startsDate"
            type="date"
            name="startsDate"
            value={values.startsDate}
            required
          />
          <FieldError message={errors.startsDate} />
        </div>

        <div class="field">
          <label for="startsTime">開始時刻</label>
          <select id="startsTime" name="startsTime">
            {buildStartsTimeOptions(values.startsTime).map((option) => (
              <option
                value={option.value}
                selected={values.startsTime === option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
          <FieldError message={errors.startsTime} />
        </div>

        <div class="field">
          <label for="durationMinutes">長さ</label>
          <select id="durationMinutes" name="durationMinutes">
            <option value="" selected={values.durationMinutes === ""}>
              未設定
            </option>
            {DURATION_OPTIONS.map((option) => (
              <option
                value={String(option.minutes)}
                selected={values.durationMinutes === String(option.minutes)}
              >
                {option.label}
              </option>
            ))}
          </select>
          <FieldError message={errors.durationMinutes} />
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

        <p>主催者キーと引き継ぎコードは作成後に発行されます。</p>

        <hr />

        <div class="checkbox-row">
          <input
            type="checkbox"
            id="discordEnabled"
            name="discordEnabled"
            checked={values.discordEnabled}
          />
          <label for="discordEnabled">
            Discord の /bandoff コマンドから開けるようにする
          </label>
        </div>
        <p>
          オンにすると、Discord サーバーのメンバーが合言葉なしでこのイベントに
          入れます(開始から24時間後まで)。
        </p>

        <div class="actions">
          <button type="submit">作成する</button>
        </div>
      </form>
    </main>
  </Layout>
);
