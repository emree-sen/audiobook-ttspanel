CREATE TABLE `listening_progress` (
	`chapter_id` text PRIMARY KEY NOT NULL,
	`position_sec` real DEFAULT 0 NOT NULL,
	`duration_sec` real,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
