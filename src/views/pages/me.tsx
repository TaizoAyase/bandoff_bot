import type { MyAssignmentItem } from "../../db/queries/songs";
import { Layout } from "../layout";

export interface MePageProps {
  slug: string;
  isParticipant: boolean;
  items: MyAssignmentItem[];
}

/**
 * 自分のエントリー一覧(`/e/:slug/me`)。当日最も使う画面(仕様 159〜161行目)
 * なので、曲名・(あれば)n回目・担当パートだけを縦に並べたシンプルな表示にする。
 */
export const MePage = ({ slug, isParticipant, items }: MePageProps) => (
  <Layout title="自分のエントリー - bandoff" page="me">
    <main class="page">
      <h1>自分のエントリー</h1>
      <p>
        <a href={`/e/${slug}/`}>← 曲一覧に戻る</a>
      </p>

      {!isParticipant ? (
        <p class="notice">
          参加登録すると、ここに自分の担当が表示されます。
          <a href={`/e/${slug}/register`}>登録する</a>
        </p>
      ) : items.length === 0 ? (
        <p class="empty-notice">まだどの枠にも入っていません。</p>
      ) : (
        <ul class="my-assignment-list">
          {items.map((item) => (
            <li class="my-assignment-row card">
              <span class="song-title">{item.songTitle}</span>
              {item.takeOrdinal !== null ? (
                <span class="take-ordinal">{item.takeOrdinal}回目</span>
              ) : null}
              <span class="slot-label">{item.slotLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  </Layout>
);
