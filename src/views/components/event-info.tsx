import { formatEventPeriod } from "../../domain/time";

export interface EventInfoProps {
  title: string;
  startsAt: number;
  durationMinutes: number | null;
  place: string;
}

/**
 * 曲一覧ページ上部に表示するイベント情報(イベント名・日時/長さ・場所)。
 * 地域は場所と重複しがちなため出さない。`#song-list` の外に置くこと
 * (ポーリング用の HTML 断片には含めない)。
 */
export const EventInfo = ({
  title,
  startsAt,
  durationMinutes,
  place,
}: EventInfoProps) => (
  <section class="event-info">
    <h1>{title}</h1>
    <p class="event-info-schedule">{formatEventPeriod(startsAt, durationMinutes)}</p>
    <p class="event-info-place">{place}</p>
  </section>
);
