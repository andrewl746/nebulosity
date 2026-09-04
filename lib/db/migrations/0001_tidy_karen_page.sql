CREATE TABLE `chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`chunk_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`exported` integer DEFAULT false NOT NULL,
	`part_index` integer DEFAULT 0 NOT NULL,
	`text` text NOT NULL,
	`file_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chunks_chunk_id_unique` ON `chunks` (`chunk_id`);--> statement-breakpoint
CREATE TABLE `meta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meta_key_unique` ON `meta` (`key`);--> statement-breakpoint
CREATE TABLE `vectors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chunk_id` integer NOT NULL,
	`embedding` blob NOT NULL,
	FOREIGN KEY (`chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
