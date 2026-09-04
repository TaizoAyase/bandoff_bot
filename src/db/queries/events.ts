import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { event } from "../schema";

/** slug からイベントを1件取得する。存在しなければ null。 */
export async function findEventBySlug(db: Db, slug: string) {
  const rows = await db.select().from(event).where(eq(event.slug, slug)).limit(1);
  return rows[0] ?? null;
}
