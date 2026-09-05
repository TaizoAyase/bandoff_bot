import type { ParticipantSummary } from "../../db/queries/participants";
import { Layout } from "../layout";

export interface ParticipantsPageProps {
  slug: string;
  participants: ParticipantSummary[];
}

/**
 * 参加者一覧(`/e/:slug/participants`)。名前と持ち込み楽器のみ(仕様 162〜164行目、
 * 当日の機材確認に使う)。並び順は `created_at` 昇順(`listParticipants` で担保)。
 */
export const ParticipantsPage = ({ slug, participants }: ParticipantsPageProps) => (
  <Layout title="参加者一覧 - bandoff" page="participants">
    <main class="page">
      <h1>参加者一覧</h1>
      <p>
        <a href={`/e/${slug}/`}>← 曲一覧に戻る</a>
      </p>
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
            </li>
          ))}
        </ul>
      )}
    </main>
  </Layout>
);
