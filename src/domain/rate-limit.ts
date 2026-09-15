/**
 * 合言葉・主催者キー・引き継ぎコードの試行回数レート制限。
 * 実際の失敗回数の集計は `db/queries/auth-failures.ts` が担当し、
 * ここでは集計結果から制限中かどうかを判定する純関数のみを置く。
 */

/** レート制限の判定窓(秒)。直近10分。 */
export const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

/** 同一イベントでの許容失敗回数(窓内)。 */
export const EVENT_FAILURE_LIMIT = 10;

/** 同一 IP での許容失敗回数(窓内)。 */
export const IP_FAILURE_LIMIT = 30;

export interface RecentFailureCounts {
  /** 同一イベントでの直近の失敗回数。 */
  eventFailures: number;
  /** 同一 IP での直近の失敗回数。 */
  ipFailures: number;
}

/**
 * イベント単位・IP 単位いずれかの閾値に達していれば制限中と判定する。
 */
export function isRateLimited(counts: RecentFailureCounts): boolean {
  return (
    counts.eventFailures >= EVENT_FAILURE_LIMIT || counts.ipFailures >= IP_FAILURE_LIMIT
  );
}

/** 新規イベント通知のレート制限の判定窓(秒)。直近1時間。 */
export const NEW_EVENT_NOTIFY_WINDOW_SECONDS = 60 * 60;

/**
 * 窓内でサイト全体に許容する新規イベント通知の件数(荒らし対策)。
 * イベントの作成自体はこの上限に関わらず常に成功させ、通知だけを省く。
 */
export const NEW_EVENT_NOTIFY_LIMIT_PER_HOUR = 3;

/**
 * 直近の窓内に(サイト全体で)作られたイベント数が上限を超えているかを
 * 判定する。今作ったイベント自身も件数に含めた上で呼び出すこと。
 */
export function isNewEventNotifyRateLimited(recentEventCount: number): boolean {
  return recentEventCount > NEW_EVENT_NOTIFY_LIMIT_PER_HOUR;
}
