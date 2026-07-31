CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_repo_path_unique` ON `files` (`repo_id`,`path`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_file_id` integer NOT NULL,
	`target_file_id` integer NOT NULL,
	`specifier` text NOT NULL,
	FOREIGN KEY (`source_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `imports_source_target_unique` ON `imports` (`source_file_id`,`target_file_id`);--> statement-breakpoint
CREATE INDEX `imports_target_idx` ON `imports` (`target_file_id`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`root_path` text NOT NULL,
	`last_scan_at` integer,
	`last_index_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_root_path_unique` ON `repositories` (`root_path`);