import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  unique,
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
  },
  (t) => [
    unique("participant_token_hash_unique").on(t.tokenHash),
    index("participant_event_id_idx").on(t.eventId),
    index("participant_event_id_recovery_key_hash_idx").on(
      t.eventId,
      t.recoveryKeyHash,
    ),
  ],
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
