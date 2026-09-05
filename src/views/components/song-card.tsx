import type { ParticipantSummary } from "../../db/queries/participants";
import type { SongNode } from "../../db/queries/songs";
import { numberInstruments } from "../../domain/instruments";
import { canDeleteSong, canDeleteTake, canEditSong } from "../../domain/permissions";
import { SlotList } from "./slot-list";

export interface SongCardProps {
  slug: string;
  song: SongNode;
  currentParticipantId: string | null;
  isOrganizer: boolean;
  participants: ParticipantSummary[];
}

/**
 * 曲一覧の1カード。Take が1件だけのときは「1回目」の見出しを出さない
 * (仕様 5章「Takeの見せ方」)。編集・削除・Take/Slot の追加削除ボタンは、
 * `domain/permissions.ts` の判定結果に応じて表示する
 * (サーバー側でも同じ関数で必ず再判定する)。
 */
export const SongCard = ({
  slug,
  song,
  currentParticipantId,
  isOrganizer,
  participants,
}: SongCardProps) => {
  const actor = { participantId: currentParticipantId, isOrganizer };
  const showTakeHeadings = song.takes.length > 1;
  const hasAnyAssignment = song.takes.some((t) =>
    t.slots.some((s) => s.assignment !== null),
  );
  const canEdit = canEditSong(actor, { proposedBy: song.proposedBy }).ok;
  const canDelete = canDeleteSong(actor, {
    proposedBy: song.proposedBy,
    isEmpty: !hasAnyAssignment,
  }).ok;
  const nextTakeOrdinal = song.takes.length + 1;

  return (
    <article class="card song-card" id={`song-${song.id}`}>
      <div class="song-header">
        <h3 class="song-title">{song.title}</h3>
        {canEdit ? (
          <a class="song-edit-link" href={`/e/${slug}/songs/${song.id}/edit`}>
            編集
          </a>
        ) : null}
      </div>
      {song.artist ? <p class="song-artist">{song.artist}</p> : null}
      {song.songKey ? <p class="song-key">キー: {song.songKey}</p> : null}
      {song.refUrl ? (
        <p class="song-ref">
          <a href={song.refUrl} rel="noreferrer">
            参考リンク
          </a>
        </p>
      ) : null}
      {song.notes ? <p class="song-notes">{song.notes}</p> : null}

      {song.takes.map((take, index) => {
        const allSlotsEmpty = take.slots.every((s) => s.assignment === null);
        const canDeleteThisTake = canDeleteTake(actor, {
          allSlotsEmpty,
          takeCount: song.takes.length,
        }).ok;
        const takeLabels = numberInstruments(take.slots.map((s) => s.instrument));
        const filledSlots = take.slots
          .map((s, i) => ({
            label: takeLabels[i] ?? s.instrument,
            assignment: s.assignment,
          }))
          .filter(
            (s): s is { label: string; assignment: NonNullable<typeof s.assignment> } =>
              s.assignment !== null,
          );
        const takeOrdinal = `${index + 1}回目`;
        const deleteTakeConfirm =
          filledSlots.length > 0
            ? `${takeOrdinal}(${filledSlots
                .map((s) => `${s.label}: ${s.assignment.participantName}さん`)
                .join("、")})を削除します。エントリーも消えます`
            : `${takeOrdinal}を削除します`;
        return (
          <div class="take">
            {showTakeHeadings ? <h4 class="take-heading">{index + 1}回目</h4> : null}
            <SlotList
              slug={slug}
              slots={take.slots}
              currentParticipantId={currentParticipantId}
              isOrganizer={isOrganizer}
              participants={participants}
            />
            <div class="take-actions">
              <a href={`/e/${slug}/takes/${take.id}/slots/new`}>+ 枠を追加</a>
              {canDeleteThisTake ? (
                <form
                  method="post"
                  action={`/e/${slug}/takes/${take.id}/delete`}
                  class="inline-form"
                  data-confirm={deleteTakeConfirm}
                >
                  <button type="submit">この回を削除</button>
                </form>
              ) : null}
            </div>
          </div>
        );
      })}

      <div class="song-actions">
        <form
          method="post"
          action={`/e/${slug}/songs/${song.id}/takes`}
          class="inline-form"
        >
          <button type="submit">{nextTakeOrdinal}回目を追加</button>
        </form>
        {canDelete ? (
          <form
            method="post"
            action={`/e/${slug}/songs/${song.id}/delete`}
            class="inline-form"
          >
            <button type="submit">曲を削除</button>
          </form>
        ) : null}
      </div>
    </article>
  );
};
