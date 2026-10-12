CREATE TABLE `summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`target_kind` text NOT NULL,
	`target_path` text NOT NULL,
	`tagline` text,
	`summary` text,
	`model` text,
	`input_hash` text,
	`status` text NOT NULL,
	`error` text,
	`batch_id` text,
	`pending_hash` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `summaries_target_unique` ON `summaries` (`repo_id`,`target_kind`,`target_path`);--> statement-breakpoint
CREATE INDEX `summaries_batch_idx` ON `summaries` (`batch_id`);--> statement-breakpoint
CREATE TABLE `summary_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`model` text NOT NULL,
	`transport` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `summary_usage_unique` ON `summary_usage` (`repo_id`,`model`,`transport`);--> statement-breakpoint
CREATE TABLE `summary_vectors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`summary_id` integer NOT NULL,
	`embedding` blob NOT NULL,
	FOREIGN KEY (`summary_id`) REFERENCES `summaries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `summary_vectors_summary_id_unique` ON `summary_vectors` (`summary_id`);--> statement-breakpoint
ALTER TABLE `chunks` ADD `name_split` text DEFAULT '' NOT NULL;