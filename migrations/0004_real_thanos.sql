CREATE TABLE `discord_link` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`discord_user_id` text NOT NULL,
	`display_name_hint` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discord_link_expires_at_idx` ON `discord_link` (`expires_at`);--> statement-breakpoint
ALTER TABLE `event` ADD `discord_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `participant_event_id_discord_user_id_unique` ON `participant` (`event_id`,`discord_user_id`) WHERE left_at IS NULL AND discord_user_id IS NOT NULL;