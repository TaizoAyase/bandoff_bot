/**
 * 各フォームの入力検証。DB に触れない純粋関数。
 * 文言はすべて日本語。エラーはフィールド名をキーにした Record で返す。
 */

import { parseJstDateTimeLocal } from "./time";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> };

type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 計画で定めた入力上限・件数上限。 */
export const LIMITS = {
  DISPLAY_NAME_MAX: 30,
  // イベントタイトルの上限は計画に明記がないため、曲名と同じ100文字を採用する。
  EVENT_TITLE_MAX: 100,
  SONG_TITLE_MAX: 100,
  ARTIST_MAX: 100,
  REF_URL_MAX: 500,
  SONG_KEY_MAX: 20,
  NOTES_MAX: 500,
  JOIN_CODE_MIN: 1,
  JOIN_CODE_MAX: 32,
  ORGANIZER_PASSWORD_MIN: 4,
  ORGANIZER_PASSWORD_MAX: 64,
  INSTRUMENT_NAME_MAX: 20,
  SLOT_NOTE_MAX: 50,
  REGION_MAX: 20,
  PLACE_MAX: 100,
  MAX_TAKES_PER_SONG: 5,
  MAX_SLOTS_PER_TAKE: 20,
  MAX_SONGS_PER_EVENT: 200,
} as const;

function requiredText(value: string, max: number, label: string): FieldResult<string> {
  const trimmed = value.trim();
  if (trimmed === "") {
    return { ok: false, error: `${label}を入力してください` };
  }
  if (trimmed.length > max) {
    return { ok: false, error: `${label}は${max}文字以内で入力してください` };
  }
  return { ok: true, value: trimmed };
}

function optionalText(value: string, max: number, label: string): FieldResult<string> {
  const trimmed = value.trim();
  if (trimmed.length > max) {
    return { ok: false, error: `${label}は${max}文字以内で入力してください` };
  }
  return { ok: true, value: trimmed };
}

/** 表示名(参加者・主催者の名前)を検証する。 */
export function validateDisplayName(value: string): FieldResult<string> {
  return requiredText(value, LIMITS.DISPLAY_NAME_MAX, "表示名");
}

/** イベントタイトルを検証する。 */
export function validateEventTitle(value: string): FieldResult<string> {
  return requiredText(value, LIMITS.EVENT_TITLE_MAX, "イベント名");
}

/** 地域(必須)を検証する。 */
export function validateRegion(value: string): FieldResult<string> {
  return requiredText(value, LIMITS.REGION_MAX, "地域");
}

/** 開催場所を検証する。 */
export function validatePlace(value: string): FieldResult<string> {
  return requiredText(value, LIMITS.PLACE_MAX, "場所");
}

/** 曲名を検証する。 */
export function validateSongTitle(value: string): FieldResult<string> {
  return requiredText(value, LIMITS.SONG_TITLE_MAX, "曲名");
}

/** アーティスト名(任意)を検証する。 */
export function validateArtist(value: string): FieldResult<string> {
  return optionalText(value, LIMITS.ARTIST_MAX, "アーティスト");
}

/** キー(任意)を検証する。 */
export function validateSongKey(value: string): FieldResult<string> {
  return optionalText(value, LIMITS.SONG_KEY_MAX, "キー");
}

/** 備考(任意)を検証する。曲・イベント共通。 */
export function validateNotes(value: string): FieldResult<string> {
  return optionalText(value, LIMITS.NOTES_MAX, "備考");
}

/** 枠のメモ(任意)を検証する。 */
export function validateSlotNote(value: string): FieldResult<string> {
  return optionalText(value, LIMITS.SLOT_NOTE_MAX, "メモ");
}

/** 参考URL(任意)を検証する。http/https のみ許可する。 */
export function validateRefUrl(value: string): FieldResult<string> {
  const trimmed = value.trim();
  if (trimmed === "") {
    return { ok: true, value: "" };
  }
  if (trimmed.length > LIMITS.REF_URL_MAX) {
    return {
      ok: false,
      error: `参考URLは${LIMITS.REF_URL_MAX}文字以内で入力してください`,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "参考URLの形式が正しくありません" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: "参考URLはhttpまたはhttpsのURLを入力してください",
    };
  }
  return { ok: true, value: trimmed };
}

/** 合言葉の照合・保存用の正規化。NFKC 正規化 + 前後空白除去。大文字小文字は区別する。 */
export function normalizeJoinCode(value: string): string {
  return value.normalize("NFKC").trim();
}

/** 合言葉を検証する(1〜32文字)。 */
export function validateJoinCode(value: string): FieldResult<string> {
  const normalized = normalizeJoinCode(value);
  if (
    normalized.length < LIMITS.JOIN_CODE_MIN ||
    normalized.length > LIMITS.JOIN_CODE_MAX
  ) {
    return {
      ok: false,
      error: `合言葉は${LIMITS.JOIN_CODE_MIN}〜${LIMITS.JOIN_CODE_MAX}文字で入力してください`,
    };
  }
  return { ok: true, value: normalized };
}

/** 主催者パスワードを検証する(4〜64文字)。 */
export function validateOrganizerPassword(value: string): FieldResult<string> {
  if (
    value.length < LIMITS.ORGANIZER_PASSWORD_MIN ||
    value.length > LIMITS.ORGANIZER_PASSWORD_MAX
  ) {
    return {
      ok: false,
      error: `主催者パスワードは${LIMITS.ORGANIZER_PASSWORD_MIN}〜${LIMITS.ORGANIZER_PASSWORD_MAX}文字で入力してください`,
    };
  }
  return { ok: true, value };
}

/** 開催日時(`<input type="datetime-local">` の値、JST)を検証する。 */
export function validateStartsAt(value: string): FieldResult<number> {
  if (value.trim() === "") {
    return { ok: false, error: "開催日時を入力してください" };
  }
  try {
    return { ok: true, value: parseJstDateTimeLocal(value) };
  } catch {
    return { ok: false, error: "開催日時の形式が正しくありません" };
  }
}

export interface NewEventFormInput {
  title: string;
  region: string;
  startsAt: string;
  place: string;
  notes: string;
  joinCode: string;
  organizerPassword: string;
  organizerDisplayName: string;
}

export interface NewEventFormValue {
  title: string;
  region: string;
  startsAt: number;
  place: string;
  notes: string;
  joinCode: string;
  organizerPassword: string;
  organizerDisplayName: string;
}

/** `/new` のイベント作成フォームを検証する。 */
export function validateNewEventForm(
  input: NewEventFormInput,
): ValidationResult<NewEventFormValue> {
  const errors: Record<string, string> = {};

  const title = validateEventTitle(input.title);
  if (!title.ok) errors.title = title.error;

  const region = validateRegion(input.region);
  if (!region.ok) errors.region = region.error;

  const startsAt = validateStartsAt(input.startsAt);
  if (!startsAt.ok) errors.startsAt = startsAt.error;

  const place = validatePlace(input.place);
  if (!place.ok) errors.place = place.error;

  const notes = validateNotes(input.notes);
  if (!notes.ok) errors.notes = notes.error;

  const joinCode = validateJoinCode(input.joinCode);
  if (!joinCode.ok) errors.joinCode = joinCode.error;

  const organizerPassword = validateOrganizerPassword(input.organizerPassword);
  if (!organizerPassword.ok) errors.organizerPassword = organizerPassword.error;

  const organizerDisplayName = validateDisplayName(input.organizerDisplayName);
  if (!organizerDisplayName.ok) {
    errors.organizerDisplayName = organizerDisplayName.error;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  // 上の各 if で ok を確認済みだが、TypeScript の narrowing が
  // オブジェクトプロパティ越しには効かないためここで再度絞り込む。
  if (
    !title.ok ||
    !region.ok ||
    !startsAt.ok ||
    !place.ok ||
    !notes.ok ||
    !joinCode.ok ||
    !organizerPassword.ok ||
    !organizerDisplayName.ok
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title: title.value,
      region: region.value,
      startsAt: startsAt.value,
      place: place.value,
      notes: notes.value,
      joinCode: joinCode.value,
      organizerPassword: organizerPassword.value,
      organizerDisplayName: organizerDisplayName.value,
    },
  };
}

export type EventStatus = "upcoming" | "closed";

function validateEventStatus(value: string): FieldResult<EventStatus> {
  if (value === "upcoming" || value === "closed") {
    return { ok: true, value };
  }
  return { ok: false, error: "募集状況の値が不正です" };
}

export interface EventEditFormInput {
  title: string;
  region: string;
  startsAt: string;
  place: string;
  notes: string;
  status: string;
}

export interface EventEditFormValue {
  title: string;
  region: string;
  startsAt: number;
  place: string;
  notes: string;
  status: EventStatus;
}

/** 主催者画面(`/organizer/event`)のイベント編集フォームを検証する。 */
export function validateEventEditForm(
  input: EventEditFormInput,
): ValidationResult<EventEditFormValue> {
  const errors: Record<string, string> = {};

  const title = validateEventTitle(input.title);
  if (!title.ok) errors.title = title.error;

  const region = validateRegion(input.region);
  if (!region.ok) errors.region = region.error;

  const startsAt = validateStartsAt(input.startsAt);
  if (!startsAt.ok) errors.startsAt = startsAt.error;

  const place = validatePlace(input.place);
  if (!place.ok) errors.place = place.error;

  const notes = validateNotes(input.notes);
  if (!notes.ok) errors.notes = notes.error;

  const status = validateEventStatus(input.status);
  if (!status.ok) errors.status = status.error;

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  if (!title.ok || !region.ok || !startsAt.ok || !place.ok || !notes.ok || !status.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title: title.value,
      region: region.value,
      startsAt: startsAt.value,
      place: place.value,
      notes: notes.value,
      status: status.value,
    },
  };
}

export interface SongFormInput {
  title: string;
  artist: string;
  refUrl: string;
  songKey: string;
  notes: string;
}

export interface SongFormValue {
  title: string;
  artist: string;
  refUrl: string;
  songKey: string;
  notes: string;
}

/** 曲の登録・編集フォームを検証する。 */
export function validateSongForm(
  input: SongFormInput,
): ValidationResult<SongFormValue> {
  const errors: Record<string, string> = {};

  const title = validateSongTitle(input.title);
  if (!title.ok) errors.title = title.error;

  const artist = validateArtist(input.artist);
  if (!artist.ok) errors.artist = artist.error;

  const refUrl = validateRefUrl(input.refUrl);
  if (!refUrl.ok) errors.refUrl = refUrl.error;

  const songKey = validateSongKey(input.songKey);
  if (!songKey.ok) errors.songKey = songKey.error;

  const notes = validateNotes(input.notes);
  if (!notes.ok) errors.notes = notes.error;

  if (!title.ok || !artist.ok || !refUrl.ok || !songKey.ok || !notes.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title: title.value,
      artist: artist.value,
      refUrl: refUrl.value,
      songKey: songKey.value,
      notes: notes.value,
    },
  };
}

export interface ParticipantFormInput {
  displayName: string;
}

export interface ParticipantFormValue {
  displayName: string;
}

/** 参加者登録・プロフィール編集フォームの表示名部分を検証する。 */
export function validateParticipantForm(
  input: ParticipantFormInput,
): ValidationResult<ParticipantFormValue> {
  const displayName = validateDisplayName(input.displayName);
  if (!displayName.ok) {
    return { ok: false, errors: { displayName: displayName.error } };
  }
  return { ok: true, value: { displayName: displayName.value } };
}

/**
 * 曲登録時のパート構成(複数枠の楽器名)を検証する。
 * 空欄の行は無視する(クライアント側の増減操作で空行が紛れ込んでも無害にする)。
 */
export function validateSongSlots(
  rawInstruments: string[],
): ValidationResult<string[]> {
  const trimmed = rawInstruments.map((v) => v.trim()).filter((v) => v !== "");

  if (trimmed.length === 0) {
    return { ok: false, errors: { instruments: "パートを1つ以上追加してください" } };
  }
  if (trimmed.length > LIMITS.MAX_SLOTS_PER_TAKE) {
    return {
      ok: false,
      errors: { instruments: `パートは${LIMITS.MAX_SLOTS_PER_TAKE}個までです` },
    };
  }
  for (const instrument of trimmed) {
    if (instrument.length > LIMITS.INSTRUMENT_NAME_MAX) {
      return {
        ok: false,
        errors: {
          instruments: `楽器名は${LIMITS.INSTRUMENT_NAME_MAX}文字以内で入力してください`,
        },
      };
    }
  }
  return { ok: true, value: trimmed };
}

export interface SlotFormInput {
  instrument: string;
  note: string;
}

export interface SlotFormValue {
  instrument: string;
  note: string;
}

/** 枠の追加フォームを検証する。 */
export function validateSlotForm(
  input: SlotFormInput,
): ValidationResult<SlotFormValue> {
  const errors: Record<string, string> = {};

  const instrument = requiredText(input.instrument, LIMITS.INSTRUMENT_NAME_MAX, "楽器");
  if (!instrument.ok) errors.instrument = instrument.error;

  const note = validateSlotNote(input.note);
  if (!note.ok) errors.note = note.error;

  if (!instrument.ok || !note.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { instrument: instrument.value, note: note.value },
  };
}
