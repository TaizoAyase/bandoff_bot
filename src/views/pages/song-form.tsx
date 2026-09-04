import { PRESET_INSTRUMENTS } from "../../domain/instruments";
import { LIMITS, type SongFormInput } from "../../domain/validation";
import { FieldError } from "../components/field-error";
import { Layout } from "../layout";

export interface SongFormPageProps {
  slug: string;
  values: SongFormInput;
  /** パート構成(初期値は DEFAULT_SLOTS)。 */
  instruments: readonly string[];
  errors: Record<string, string>;
}

export const emptySongFormValues: SongFormInput = {
  title: "",
  artist: "",
  refUrl: "",
  songKey: "",
  notes: "",
};

const SlotRow = ({
  instrument,
  required,
}: {
  instrument: string;
  required: boolean;
}) => (
  <div class="slot-row" data-slot-row>
    <input
      type="text"
      name="instrument"
      list="instrument-presets"
      value={instrument}
      maxlength={LIMITS.INSTRUMENT_NAME_MAX}
      placeholder="楽器"
      required={required}
    />
    <button type="button" data-action="remove-slot">
      削除
    </button>
  </div>
);

/** 曲の登録フォーム(`/e/:slug/songs/new`)。 */
export const SongFormPage = ({
  slug,
  values,
  instruments,
  errors,
}: SongFormPageProps) => (
  <Layout title="曲を追加 - bandoff" page="song-form">
    <main class="page">
      <h1>曲を追加</h1>
      <p>
        <a href={`/e/${slug}/`}>← 曲一覧に戻る</a>
      </p>
      <form method="post" action={`/e/${slug}/songs`}>
        <div class="field">
          <label for="title">曲名</label>
          <input
            id="title"
            type="text"
            name="title"
            value={values.title}
            maxlength={LIMITS.SONG_TITLE_MAX}
            required
          />
          <FieldError message={errors.title} />
        </div>

        <div class="field">
          <label for="artist">アーティスト</label>
          <input
            id="artist"
            type="text"
            name="artist"
            value={values.artist}
            maxlength={LIMITS.ARTIST_MAX}
          />
          <FieldError message={errors.artist} />
        </div>

        <div class="field">
          <label for="refUrl">参考URL</label>
          <input
            id="refUrl"
            type="url"
            name="refUrl"
            value={values.refUrl}
            maxlength={LIMITS.REF_URL_MAX}
            placeholder="https://..."
          />
          <FieldError message={errors.refUrl} />
        </div>

        <div class="field">
          <label for="songKey">キー</label>
          <input
            id="songKey"
            type="text"
            name="songKey"
            value={values.songKey}
            maxlength={LIMITS.SONG_KEY_MAX}
          />
          <FieldError message={errors.songKey} />
        </div>

        <div class="field">
          <label for="notes">備考</label>
          <textarea id="notes" name="notes" maxlength={LIMITS.NOTES_MAX}>
            {values.notes}
          </textarea>
          <FieldError message={errors.notes} />
        </div>

        <hr />
        <h2>パート構成</h2>
        <FieldError message={errors.instruments} />
        <div id="slot-rows">
          {instruments.map((instrument) => (
            <SlotRow instrument={instrument} required={true} />
          ))}
        </div>
        <template id="slot-row-template">
          <SlotRow instrument="" required={false} />
        </template>
        <datalist id="instrument-presets">
          {PRESET_INSTRUMENTS.map((name) => (
            <option value={name} />
          ))}
        </datalist>
        <button type="button" id="add-slot-button">
          + パートを追加
        </button>

        <div class="actions">
          <button type="submit">曲を登録する</button>
        </div>
      </form>
    </main>
  </Layout>
);
