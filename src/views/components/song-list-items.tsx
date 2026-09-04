import type { SongNode } from "../../db/queries/songs";
import { SongCard } from "./song-card";

export interface SongListItemsProps {
  slug: string;
  songs: SongNode[];
  currentParticipantId: string | null;
}

/**
 * `#song-list` の中身(曲カード群)。曲一覧ページ本体と、ポーリング用の
 * HTML 断片(`GET /e/:slug/fragments/songs`)の両方から使う。
 */
export const SongListItems = ({
  slug,
  songs,
  currentParticipantId,
}: SongListItemsProps) => {
  if (songs.length === 0) {
    return <p class="empty-notice">まだ曲が登録されていません。</p>;
  }
  return (
    <>
      {songs.map((song) => (
        <SongCard slug={slug} song={song} currentParticipantId={currentParticipantId} />
      ))}
    </>
  );
};
