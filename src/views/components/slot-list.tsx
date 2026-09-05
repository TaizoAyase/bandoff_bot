import type { ParticipantSummary } from "../../db/queries/participants";
import type { SlotNode } from "../../db/queries/songs";
import { numberInstruments } from "../../domain/instruments";
import { canDeleteSlot } from "../../domain/permissions";

export interface SlotListProps {
  slug: string;
  slots: SlotNode[];
  currentParticipantId: string | null;
  isOrganizer: boolean;
  /** 主催者の代理エントリー用の参加者一覧(organizer 以外には空配列で渡す)。 */
  participants: ParticipantSummary[];
}

/**
 * 1つの Take 内の枠一覧。埋まっている枠は担当者名(+自分なら辞退ボタン、
 * 主催者なら代理で辞退させるボタン)、空き枠は「+ 参加」ボタン(主催者は
 * 参加者を選んで代理エントリーもできる)。削除ボタンは
 * `domain/permissions.ts` の `canDeleteSlot` に従って表示する。
 * `Gt1`/`Gt2` の自動採番は表示時に行う。
 */
export const SlotList = ({
  slug,
  slots,
  currentParticipantId,
  isOrganizer,
  participants,
}: SlotListProps) => {
  const labels = numberInstruments(slots.map((s) => s.instrument));
  const actor = { participantId: currentParticipantId, isOrganizer };
  return (
    <ul class="slot-list">
      {slots.map((slotNode, index) => {
        const label = labels[index] ?? slotNode.instrument;
        const assignment = slotNode.assignment;
        const isFilled = assignment !== null;
        const isMine = isFilled && assignment.participantId === currentParticipantId;
        const canDeleteThisSlot = canDeleteSlot(actor, { isEmpty: !isFilled }).ok;

        return (
          <li class={isFilled ? "slot slot-filled" : "slot slot-empty"}>
            <span class="slot-label">{label}</span>
            {assignment ? (
              <span class="slot-name">{assignment.participantName}</span>
            ) : null}
            {slotNode.note ? <span class="slot-note">{slotNode.note}</span> : null}

            {isMine ? (
              <form
                method="post"
                action={`/e/${slug}/slots/${slotNode.id}/leave`}
                class="slot-action"
              >
                <button type="submit">辞退</button>
              </form>
            ) : null}

            {isFilled && !isMine && isOrganizer && assignment ? (
              <form
                method="post"
                action={`/e/${slug}/slots/${slotNode.id}/leave`}
                class="slot-action"
                data-confirm={`${label}(${assignment.participantName}さん)を辞退させます`}
              >
                <button type="submit">辞退させる</button>
              </form>
            ) : null}

            {!isFilled ? (
              <form
                method="post"
                action={`/e/${slug}/slots/${slotNode.id}/join`}
                class="slot-action"
              >
                <button type="submit">+ 参加</button>
              </form>
            ) : null}

            {!isFilled && isOrganizer && participants.length > 0 ? (
              <form
                method="post"
                action={`/e/${slug}/slots/${slotNode.id}/join`}
                class="slot-action slot-action-proxy-join"
              >
                <select name="participantId" aria-label="参加者を選ぶ">
                  {participants.map((p) => (
                    <option value={p.id}>{p.displayName}</option>
                  ))}
                </select>
                <button type="submit">を入れる</button>
              </form>
            ) : null}

            {canDeleteThisSlot ? (
              <form
                method="post"
                action={`/e/${slug}/slots/${slotNode.id}/delete`}
                class="slot-action"
                data-confirm={
                  isFilled && assignment
                    ? `${label}(${assignment.participantName}さん)を削除します`
                    : undefined
                }
              >
                <button type="submit">削除</button>
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};
