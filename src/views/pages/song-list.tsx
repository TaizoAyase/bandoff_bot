import type { ParticipantSummary } from "../../db/queries/participants";
import type { SongNode } from "../../db/queries/songs";
import { EventInfo } from "../components/event-info";
import { SongListItems } from "../components/song-list-items";
import { Layout } from "../layout";

export type SongListNotice =
  | "joined"
  | "left"
  | "taken"
  | "discord-linked"
  | "discord-link-conflict";

const NOTICE_MESSAGES: Record<SongListNotice, string> = {
  joined: "エントリーしました",
  left: "辞退しました",
  taken: "先を越されました",
  "discord-linked": "Discord アカウントと紐付けました",
  "discord-link-conflict": "この Discord アカウントは別の参加者に紐付いています",
};

export function parseSongListNotice(
  value: string | undefined,
): SongListNotice | undefined {
  if (
    value === "joined" ||
    value === "left" ||
    value === "taken" ||
    value === "discord-linked" ||
    value === "discord-link-conflict"
  ) {
    return value;
  }
  return undefined;
}

export interface SongListPageProps {
  slug: string;
  title: string;
  startsAt: number;
  durationMinutes: number | null;
  place: string;
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
  /**
   * Discord 紐付けの確認バナー(計画5-5の B)。participant あり・未紐付け・
   * 紐付け待ちありのときだけ、その participant の表示名(Discord 側の
   * 名前ではない)を渡す。無ければ null。
   */
  discordLinkConfirmName: string | null;
  /** Discord からの登録案内バナー(計画5-5の C)。participant なし・紐付け待ちありのとき true。 */
  showDiscordRegisterBanner: boolean;
}

/**
 * 曲一覧(メイン画面)。`#song-list` の中身は
 * `src/views/components/song-list-items.tsx` を共有し、ポーリング用の
 * HTML 断片(`GET /e/:slug/fragments/songs`)と同じ描画にする。
 * イベント情報ブロック(`EventInfo`)は `#song-list` の外に置く
 * (断片には含めない)。
 */
export const SongListPage = ({
  slug,
  title,
  startsAt,
  durationMinutes,
  place,
  songs,
  currentParticipantId,
  isOrganizer,
  participants,
  notice,
  past24h,
  status,
  discordLinkConfirmName,
  showDiscordRegisterBanner,
}: SongListPageProps) => (
  <Layout title={`${title} - bandoff`} page="song-list">
    <main class="page" data-slug={slug} data-participant={currentParticipantId ?? "0"}>
      <EventInfo
        title={title}
        startsAt={startsAt}
        durationMinutes={durationMinutes}
        place={place}
      />
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

      {discordLinkConfirmName ? (
        <div class="notice">
          <p>
            この Discord アカウントを「{discordLinkConfirmName}」と紐付けますか?
            紐付けると、次回から Discord の /bandoff open でそのまま入れます。
          </p>
          <form method="post" action={`/e/${slug}/discord/link`} class="inline-form">
            <button type="submit">紐付ける</button>
          </form>{" "}
          <form method="post" action={`/e/${slug}/discord/dismiss`} class="inline-form">
            <button type="submit">今はしない</button>
          </form>
        </div>
      ) : null}

      {showDiscordRegisterBanner ? (
        <div class="notice">
          <p>
            Discord から開きました。参加登録すると、次回から /bandoff open で
            そのまま入れます。
          </p>
          <a href={`/e/${slug}/register`}>参加登録する</a>
          。登録済みの人は
          <a href={`/e/${slug}/recover`}>引き継ぎコードで入る</a>
          から入ってください。
        </div>
      ) : null}

      {!currentParticipantId ? (
        <p class="notice">
          参加すると曲を追加できます。
          <a href={`/e/${slug}/recover`}>
            別の端末で登録済みの方はこちら(引き継ぎコード)
          </a>
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
