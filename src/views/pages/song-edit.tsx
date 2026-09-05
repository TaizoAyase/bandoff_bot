import { LIMITS, type SongFormInput } from "../../domain/validation";
import { FieldError } from "../components/field-error";
import { Layout } from "../layout";

export interface SongEditPageProps {
  slug: string;
  songId: string;
  values: SongFormInput;
  errors: Record<string, string>;
}

/**
 * 曲情報の編集フォーム(`/e/:slug/songs/:id/edit`)。枠構成(Take・Slot)は
 * 対象外で、タイトル・アーティスト・参考URL・キー・備考のみを編集する。
 */
export const SongEditPage = ({ slug, songId, values, errors }: SongEditPageProps) => (
  <Layout title="曲を編集 - bandoff" page="song-edit">
    <main class="page">
      <h1>曲を編集</h1>
      <p>
        <a href={`/e/${slug}/#song-${songId}`}>← 曲一覧に戻る</a>
      </p>
      <form method="post" action={`/e/${slug}/songs/${songId}`}>
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

        <div class="actions">
          <button type="submit">更新する</button>
        </div>
      </form>
    </main>
  </Layout>
);
