import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const workspace = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    discordGuildId: text("discord_guild_id"),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [unique("workspace_discord_guild_id_unique").on(t.discordGuildId)],
);

export const event = sqliteTable(
  "event",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    region: text("region").notNull(),
    startsAt: integer("starts_at").notNull(),
    // 所要時間(分)。既存イベントには値がないため nullable。
    // ALTER TABLE で非破壊に追加したため、終了時刻(ends_at)列は作らず
    // 表示時に startsAt + durationMinutes から計算する。
    durationMinutes: integer("duration_minutes"),
    place: text("place").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("upcoming"),
    joinCode: text("join_code").notNull(),
    organizerKeyHash: text("organizer_key_hash").notNull(),
    // 主催者自身の Participant への参照。event と participant は循環参照のため
    // コールバック形式で参照する。作成時は db.batch() で原子的に埋める。
    organizerParticipantId: text("organizer_participant_id").references(
      (): AnySQLiteColumn => participant.id,
      { onDelete: "set null" },
    ),
    // Discord の /bandoff コマンドからこのイベントを開けるようにするか。
    // 主催者が作成フォーム・編集画面のチェックボックスで指定する
    // (既定は新規イベントで true、既存イベントは移行で false)。
    discordEnabled: integer("discord_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    unique("event_slug_unique").on(t.slug),
    index("event_workspace_id_idx").on(t.workspaceId),
  ],
);

export const participant = sqliteTable(
  "participant",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references((): AnySQLiteColumn => event.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    instruments: text("instruments", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    tokenHash: text("token_hash").notNull(),
    recoveryKeyHash: text("recovery_key_hash").notNull(),
    discordUserId: text("discord_user_id"),
    createdAt: integer("created_at").notNull(),
    // 参加取りやめ・主催者による削除の日時。物理削除はしない
    // (song.proposedBy 等の他テーブルが restrict で参照しているため)。
    // null なら現在も参加中。既存行には値がないため nullable。
    leftAt: integer("left_at"),
  },
  (t) => [
    unique("participant_token_hash_unique").on(t.tokenHash),
    index("participant_event_id_idx").on(t.eventId),
    index("participant_event_id_recovery_key_hash_idx").on(
      t.eventId,
      t.recoveryKeyHash,
    ),
    // 1つのイベントで、同じ Discord アカウントに紐付いた「現在参加中」の
    // participant が2件以上できないようにする部分ユニークインデックス。
    // 参加を取りやめた行(left_at が非 null)は対象外にするため、取りやめ後に
    // 同じ Discord アカウントで再登録できる。
    uniqueIndex("participant_event_id_discord_user_id_unique")
      .on(t.eventId, t.discordUserId)
      .where(sql`left_at IS NULL AND discord_user_id IS NOT NULL`),
  ],
);

/**
 * Discord の `/bandoff open` 等から発行される、1回限りのイベント参照リンク用
 * トークン。平文のトークンは保存せず、SHA-256 ハッシュだけを持つ
 * (`token_hash` は既存の `sha256Hex` で計算する)。
 * 発行のたびに期限切れの行を掃除するため、行数は小さく保たれる想定
 * (計画3-2)。
 */
export const discordLink = sqliteTable(
  "discord_link",
  {
    tokenHash: text("token_hash").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    discordUserId: text("discord_user_id").notNull(),
    // 発行時点での既定表示名(サーバーニックネーム→グローバル表示名→
    // ユーザー名の優先順位で決めたヒント)。
    displayNameHint: text("display_name_hint").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (t) => [index("discord_link_expires_at_idx").on(t.expiresAt)],
);

export const song = sqliteTable(
  "song",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    artist: text("artist"),
    refUrl: text("ref_url"),
    songKey: text("song_key"),
    notes: text("notes"),
    proposedBy: text("proposed_by")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("song_event_id_created_at_idx").on(t.eventId, t.createdAt)],
);

export const take = sqliteTable(
  "take",
  {
    id: text("id").primaryKey(),
    songId: text("song_id")
      .notNull()
      .references(() => song.id, { onDelete: "cascade" }),
    label: text("label"),
    sortOrder: integer("sort_order").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("take_song_id_sort_order_idx").on(t.songId, t.sortOrder)],
);

export const slot = sqliteTable(
  "slot",
  {
    id: text("id").primaryKey(),
    takeId: text("take_id")
      .notNull()
      .references(() => take.id, { onDelete: "cascade" }),
    instrument: text("instrument").notNull(),
    note: text("note"),
    sortOrder: integer("sort_order").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("slot_take_id_sort_order_idx").on(t.takeId, t.sortOrder)],
);

export const assignment = sqliteTable(
  "assignment",
  {
    id: text("id").primaryKey(),
    slotId: text("slot_id")
      .notNull()
      .references(() => slot.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    unique("assignment_slot_id_unique").on(t.slotId),
    index("assignment_participant_id_idx").on(t.participantId),
  ],
);

export const authFailure = sqliteTable(
  "auth_failure",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    ip: text("ip").notNull(),
    kind: text("kind", {
      enum: ["join_code", "organizer_key", "recovery_key"],
    }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("auth_failure_event_id_created_at_idx").on(t.eventId, t.createdAt),
    index("auth_failure_ip_created_at_idx").on(t.ip, t.createdAt),
  ],
);
