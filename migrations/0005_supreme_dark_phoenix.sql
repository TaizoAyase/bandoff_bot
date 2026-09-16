CREATE TABLE `song_score_url` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text NOT NULL,
	`url` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `song`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `song_score_url_song_id_sort_order_idx` ON `song_score_url` (`song_id`,`sort_order`);