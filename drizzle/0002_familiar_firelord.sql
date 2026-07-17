CREATE TABLE `audio_cache` (
	`hash` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`duration_ms` real DEFAULT 0 NOT NULL,
	`usd` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`script_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`limit_calls` integer,
	`calls_used` integer DEFAULT 0 NOT NULL,
	`done_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer NOT NULL,
	`paused_reason` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`script_id`) REFERENCES `scripts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tts_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`day` text NOT NULL,
	`segment_id` text,
	`ok` integer DEFAULT 1 NOT NULL,
	`usd` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tts_calls_provider_day` ON `tts_calls` (`provider`,`day`);