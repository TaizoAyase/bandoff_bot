import { and, eq, gte, lt, sql } from "drizzle-orm";
import { newId } from "../../domain/ids";
import {
  RATE_LIMIT_WINDOW_SECONDS,
  type RecentFailureCounts,
} from "../../domain/rate-limit";
import type { Db } from "../client";
import { authFailure } from "../schema";

export type AuthFailureKind = (typeof authFailure.$inferInsert)["kind"];

/**
 * `since` 以降の失敗回数を、イベント単位・IP単位でそれぞれ数える。
 * 1回の `db.batch()` で両方の集計を行う。
 */
export async function countRecentFailures(
  db: Db,
  eventId: string,
  ip: string,
  since: number,
): Promise<RecentFailureCounts> {
  const [eventRows, ipRows] = await db.batch([
    db
      .select({ count: sql<number>`count(*)` })
      .from(authFailure)
      .where(and(eq(authFailure.eventId, eventId), gte(authFailure.createdAt, since))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(authFailure)
      .where(and(eq(authFailure.ip, ip), gte(authFailure.createdAt, since))),
  ]);
  return {
    eventFailures: eventRows[0]?.count ?? 0,
    ipFailures: ipRows[0]?.count ?? 0,
  };
}

/**
 * 失敗を1件記録する。同時に窓(直近10分)より古い行を purge する。
 * 記録と purge は1回の `db.batch()` で行う。
 */
export async function recordFailure(
  db: Db,
  eventId: string,
  ip: string,
  kind: AuthFailureKind,
  now: number,
): Promise<void> {
  const purgeBefore = now - RATE_LIMIT_WINDOW_SECONDS;
  await db.batch([
    db.insert(authFailure).values({ id: newId(), eventId, ip, kind, createdAt: now }),
    db.delete(authFailure).where(lt(authFailure.createdAt, purgeBefore)),
  ]);
}
