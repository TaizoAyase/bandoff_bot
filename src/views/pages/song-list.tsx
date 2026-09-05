import type { ParticipantSummary } from "../../db/queries/participants";
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
  isOrganizer: boolean;
  /** 主催者の代理エントリー用の参加者一覧(organizer 以外には空配列で渡す)。 */
  participants: ParticipantSummary[];
  notice?: SongListNotice;
  /** 開催日時から24時間以上経過しているか(仕様: バナー表示のみ)。 */
  past24h: boolean;
  /** `event.status`。DB 上は文字列なので、ここでは `"closed"` かどうかだけを見る。 */
  status: string;
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
  isOrganizer,
  participants,
  notice,
  past24h,
  status,
}: SongListPageProps) => (
  <Layout title="曲一覧 - bandoff" page="song-list">
    <main class="page" data-slug={slug} data-participant={currentParticipantId ?? "0"}>
      <h1>曲一覧</h1>
      <nav class="song-list-nav">
        <a href={`/e/${slug}/songs/new`}>曲を追加</a>
        <a href={`/e/${slug}/me`}>自分のエントリー</a>
        <a href={`/e/${slug}/participants`}>参加者一覧</a>
        <a href={`/e/${slug}/settings`}>設定</a>
        {isOrganizer ? (
          <a href={`/e/${slug}/organizer`}>主催者設定</a>
        ) : (
          <a href={`/e/${slug}/organizer/login`}>主催者ログイン</a>
        )}
      </nav>

      {past24h ? (
        <p class="notice notice-warning">
          このイベントは開催日時から24時間以上経過しています
        </p>
      ) : null}
      {status === "closed" ? (
        <p class="notice notice-warning">募集は締め切られています(主催者のみ編集可)</p>
      ) : null}

      {!currentParticipantId ? (
        <p class="notice">
          参加すると曲を追加できます。
          <a href={`/e/${slug}/recover`}>別の端末で登録済みの方はこちら(復帰キー)</a>
        </p>
      ) : null}
      {notice ? <p class="notice">{NOTICE_MESSAGES[notice]}</p> : null}

      <div id="song-list">
        <SongListItems
          slug={slug}
          songs={songs}
          currentParticipantId={currentParticipantId}
          isOrganizer={isOrganizer}
          participants={participants}
        />
      </div>
    </main>
  </Layout>
);
