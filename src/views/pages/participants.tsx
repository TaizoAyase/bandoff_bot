import type { ParticipantSummary } from "../../db/queries/participants";
import type { MyAssignmentItem } from "../../db/queries/songs";
import { Layout } from "../layout";

export interface ParticipantRow extends ParticipantSummary {
  /**
   * この参加者の全エントリー(organizer が一括辞退ボタンの表示可否・
   * 確認文言に使う)。organizer 以外への表示時は常に空配列。
   */
  entries: MyAssignmentItem[];
}

export type ParticipantsNotice = "left-all";

const NOTICE_MESSAGES: Record<ParticipantsNotice, string> = {
  "left-all": "辞退させました",
};

export function parseParticipantsNotice(
  value: string | undefined,
): ParticipantsNotice | undefined {
  return value === "left-all" ? value : undefined;
}

export interface ParticipantsPageProps {
  slug: string;
  participants: ParticipantRow[];
  isOrganizer: boolean;
  notice?: ParticipantsNotice;
}

/**
 * 参加者一覧(`/e/:slug/participants`)。名前と持ち込み楽器のみ(仕様 162〜164行目、
 * 当日の機材確認に使う)。並び順は `created_at` 昇順(`listParticipants` で担保)。
 * 主催者には、各参加者のエントリーが1件以上あるときだけ一括辞退ボタンを出す。
 */
export const ParticipantsPage = ({
  slug,
  participants,
  isOrganizer,
  notice,
}: ParticipantsPageProps) => (
  <Layout title="参加者一覧 - bandoff" page="participants">
    <main class="page">
      <h1>参加者一覧</h1>
      <p>
        <a href={`/e/${slug}/`}>← 曲一覧に戻る</a>
      </p>
      {notice ? <p class="notice">{NOTICE_MESSAGES[notice]}</p> : null}
      {participants.length === 0 ? (
        <p class="empty-notice">まだ参加者がいません。</p>
      ) : (
        <ul class="participant-list">
          {participants.map((p) => (
            <li class="participant-row">
              <span class="participant-name">{p.displayName}</span>
              {p.instruments.length > 0 ? (
                <span class="participant-instruments">{p.instruments.join(", ")}</span>
              ) : null}
              {isOrganizer && p.entries.length > 0 ? (
                <form
                  method="post"
                  action={`/e/${slug}/participants/${p.id}/leave-all`}
                  class="inline-form"
                  data-confirm={`${p.displayName}さんの全エントリー(${p.entries
                    .map((entry) => `${entry.songTitle}: ${entry.slotLabel}`)
                    .join("、")})を辞退させます`}
                >
                  <button type="submit">全エントリーを辞退させる</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  </Layout>
);
