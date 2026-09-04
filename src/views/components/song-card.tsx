import type { SongNode } from "../../db/queries/songs";
import { SlotList } from "./slot-list";

export interface SongCardProps {
  slug: string;
  song: SongNode;
  currentParticipantId: string | null;
}

/**
 * 曲一覧の1カード。Take が1件だけのときは「1回目」の見出しを出さない
 * (仕様 5章「Takeの見せ方」)。
 */
export const SongCard = ({ slug, song, currentParticipantId }: SongCardProps) => {
  const showTakeHeadings = song.takes.length > 1;
  return (
    <article class="card song-card" id={`song-${song.id}`}>
      <h3 class="song-title">{song.title}</h3>
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

      {song.takes.map((take, index) => (
        <div class="take">
          {showTakeHeadings ? <h4 class="take-heading">{index + 1}回目</h4> : null}
          <SlotList
            slug={slug}
            slots={take.slots}
            currentParticipantId={currentParticipantId}
          />
        </div>
      ))}
    </article>
  );
};
