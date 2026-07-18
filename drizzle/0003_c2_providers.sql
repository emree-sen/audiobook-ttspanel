CREATE TABLE `tts_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `voices` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`voice` text NOT NULL,
	`gender` text DEFAULT '' NOT NULL,
	`tone` text DEFAULT '' NOT NULL,
	`path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voices_provider_voice` ON `voices` (`provider`,`voice`);
--> statement-breakpoint
INSERT INTO `voices` (`id`,`provider`,`voice`,`gender`,`tone`,`path`,`created_at`) VALUES
('voc_seed_01','gemini','Charon','male','olgun, anlatıcı',NULL,0),
('voc_seed_02','gemini','Iapetus','male','derin',NULL,0),
('voc_seed_03','gemini','Puck','male','genç, enerjik',NULL,0),
('voc_seed_04','gemini','Algenib','male','sert',NULL,0),
('voc_seed_05','gemini','Algieba','male','yumuşak',NULL,0),
('voc_seed_06','gemini','Schedar','male','ölçülü',NULL,0),
('voc_seed_07','gemini','Kore','female','bilge, sakin',NULL,0),
('voc_seed_08','gemini','Leda','female','genç, canlı',NULL,0);