CREATE TABLE `assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `slot`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `assignment_participant_id_idx` ON `assignment` (`participant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_slot_id_unique` ON `assignment` (`slot_id`);--> statement-breakpoint
CREATE TABLE `auth_failure` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`ip` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_failure_event_id_created_at_idx` ON `auth_failure` (`event_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_failure_ip_created_at_idx` ON `auth_failure` (`ip`,`created_at`);--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`region` text NOT NULL,
	`starts_at` integer NOT NULL,
	`place` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'upcoming' NOT NULL,
	`join_code` text NOT NULL,
	`organizer_pw_hash` text NOT NULL,
	`organizer_participant_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organizer_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `event_workspace_id_idx` ON `event` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_slug_unique` ON `event` (`slug`);--> statement-breakpoint
CREATE TABLE `participant` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`display_name` text NOT NULL,
	`instruments` text DEFAULT '[]' NOT NULL,
	`token_hash` text NOT NULL,
	`recovery_key_hash` text NOT NULL,
	`discord_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participant_event_id_idx` ON `participant` (`event_id`);--> statement-breakpoint
CREATE INDEX `participant_event_id_recovery_key_hash_idx` ON `participant` (`event_id`,`recovery_key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `participant_token_hash_unique` ON `participant` (`token_hash`);--> statement-breakpoint
CREATE TABLE `slot` (
	`id` text PRIMARY KEY NOT NULL,
	`take_id` text NOT NULL,
	`instrument` text NOT NULL,
	`note` text,
	`sort_order` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`take_id`) REFERENCES `take`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `slot_take_id_sort_order_idx` ON `slot` (`take_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `song` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`ref_url` text,
	`song_key` text,
	`notes` text,
	`proposed_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposed_by`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `song_event_id_created_at_idx` ON `song` (`event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `take` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text NOT NULL,
	`label` text,
	`sort_order` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `song`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `take_song_id_sort_order_idx` ON `take` (`song_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_guild_id` text,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_discord_guild_id_unique` ON `workspace` (`discord_guild_id`);