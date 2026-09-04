import type { SongNode } from "../../db/queries/songs";
import { SongListItems } from "../components/song-list-items";
import { Layout } from "../layout";

export type SongListNotice = "joined" | "left" | "taken";

const NOTICE_MESSAGES: Record<SongListNotice, string> = {
  joined: "エントリーしました",
  left: "辞退しました",
  taken: "先を越されました",
};

export function parseSongListNotice(
  value: string | undefined,
): SongListNotice | undefined {
  if (value === "joined" || value === "left" || value === "taken") {
    return value;
  }
  return undefined;
}

export interface SongListPageProps {
  slug: string;
  songs: SongNode[];
  currentParticipantId: string | null;
  notice?: SongListNotice;
}

/**
 * 曲一覧(メイン画面)。`#song-list` の中身は
 * `src/views/components/song-list-items.tsx` を共有し、ポーリング用の
 * HTML 断片(`GET /e/:slug/fragments/songs`)と同じ描画にする。
 */
export const SongListPage = ({
  slug,
  songs,
  currentParticipantId,
  notice,
}: SongListPageProps) => (
  <Layout title="曲一覧 - bandoff" page="song-list">
    <main class="page" data-slug={slug} data-participant={currentParticipantId ?? "0"}>
      <h1>曲一覧</h1>
      <nav class="song-list-nav">
        <a href={`/e/${slug}/songs/new`}>曲を追加</a>
        <a href={`/e/${slug}/me`}>自分のエントリー</a>
        <a href={`/e/${slug}/participants`}>参加者一覧</a>
        <a href={`/e/${slug}/settings`}>設定</a>
      </nav>

      {!currentParticipantId ? <p class="notice">参加すると曲を追加できます</p> : null}
      {notice ? <p class="notice">{NOTICE_MESSAGES[notice]}</p> : null}

      <div id="song-list">
        <SongListItems
          slug={slug}
          songs={songs}
          currentParticipantId={currentParticipantId}
        />
      </div>
    </main>
  </Layout>
);
