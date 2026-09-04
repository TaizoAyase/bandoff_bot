import type { SlotNode } from "../../db/queries/songs";
import { numberInstruments } from "../../domain/instruments";

export interface SlotListProps {
  slug: string;
  slots: SlotNode[];
  currentParticipantId: string | null;
}

/**
 * 1つの Take 内の枠一覧。埋まっている枠は担当者名(+自分なら辞退ボタン)、
 * 空き枠は「+ 参加」ボタンを出す。`Gt1`/`Gt2` の自動採番は表示時に行う。
 */
export const SlotList = ({ slug, slots, currentParticipantId }: SlotListProps) => {
  const labels = numberInstruments(slots.map((s) => s.instrument));
  return (
    <ul class="slot-list">
      {slots.map((slotNode, index) => {
        const label = labels[index] ?? slotNode.instrument;
        const isMine =
          slotNode.assignment !== null &&
          slotNode.assignment.participantId === currentParticipantId;
        return (
          <li class={slotNode.assignment ? "slot slot-filled" : "slot slot-empty"}>
            <span class="slot-label">{label}</span>
            {slotNode.assignment ? (
              <span class="slot-name">{slotNode.assignment.participantName}</span>
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
            {!slotNode.assignment ? (
              <form
                method="post"
                action={`/e/${slug}/slots/${slotNode.id}/join`}
                class="slot-action"
              >
                <button type="submit">+ 参加</button>
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};
