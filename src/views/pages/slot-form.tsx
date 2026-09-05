import { PRESET_INSTRUMENTS } from "../../domain/instruments";
import { LIMITS, type SlotFormInput } from "../../domain/validation";
import { FieldError } from "../components/field-error";
import { Layout } from "../layout";

export interface SlotFormPageProps {
  slug: string;
  takeId: string;
  songTitle: string;
  values: SlotFormInput;
  errors: Record<string, string>;
}

export const emptySlotFormValues: SlotFormInput = { instrument: "", note: "" };

/**
 * 枠(Slot)の追加フォーム(`/e/:slug/takes/:id/slots/new`)。
 * 曲一覧の中に置かず独立したページにすることで、ポーリングによる
 * `#song-list` の差し替えで入力中の内容が消えないようにしている。
 */
export const SlotFormPage = ({
  slug,
  takeId,
  songTitle,
  values,
  errors,
}: SlotFormPageProps) => (
  <Layout title="枠を追加 - bandoff" page="slot-form">
    <main class="page">
      <h1>枠を追加</h1>
      <p class="song-title">{songTitle}</p>
      <p>
        <a href={`/e/${slug}/`}>← 曲一覧に戻る</a>
      </p>
      <form method="post" action={`/e/${slug}/takes/${takeId}/slots`}>
        <div class="field">
          <label for="instrument">楽器</label>
          <input
            id="instrument"
            type="text"
            name="instrument"
            list="instrument-presets"
            value={values.instrument}
            maxlength={LIMITS.INSTRUMENT_NAME_MAX}
            placeholder="楽器"
            required
          />
          <FieldError message={errors.instrument} />
        </div>
        <datalist id="instrument-presets">
          {PRESET_INSTRUMENTS.map((name) => (
            <option value={name} />
          ))}
        </datalist>

        <div class="field">
          <label for="note">メモ</label>
          <input
            id="note"
            type="text"
            name="note"
            value={values.note}
            maxlength={LIMITS.SLOT_NOTE_MAX}
            placeholder="例: リード、コーラス兼任"
          />
          <FieldError message={errors.note} />
        </div>

        <div class="actions">
          <button type="submit">追加する</button>
        </div>
      </form>
    </main>
  </Layout>
);
