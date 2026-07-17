ALTER TABLE `chapters` ADD `voice_mode` text DEFAULT 'narrator' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD `max_characters` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `scripts` ADD `usage_json` text;