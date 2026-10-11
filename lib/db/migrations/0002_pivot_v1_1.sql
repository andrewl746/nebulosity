CREATE TABLE `folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`path` text NOT NULL,
	`parent_path` text,
	`depth` integer NOT NULL,
	`name` text NOT NULL,
	`file_count` integer NOT NULL,
	`direct_file_count` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folders_repo_path_unique` ON `folders` (`repo_id`,`path`);--> statement-breakpoint
CREATE INDEX `folders_repo_parent_idx` ON `folders` (`repo_id`,`parent_path`);--> statement-breakpoint
CREATE TABLE `level_edges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`level_path` text NOT NULL,
	`source_node` text NOT NULL,
	`target_node` text NOT NULL,
	`count` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `level_edges_unique` ON `level_edges` (`repo_id`,`level_path`,`source_node`,`target_node`);--> statement-breakpoint
CREATE TABLE `symbols` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`name` text NOT NULL,
	`qualified_name` text NOT NULL,
	`kind` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`exported` integer DEFAULT false NOT NULL,
	`parent_qualified_name` text,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `symbols_file_idx` ON `symbols` (`file_id`);--> statement-breakpoint
CREATE INDEX `symbols_name_idx` ON `symbols` (`name`);--> statement-breakpoint
DROP INDEX `chunks_chunk_id_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `chunks_file_chunk_unique` ON `chunks` (`file_id`,`chunk_id`);--> statement-breakpoint
ALTER TABLE `files` ADD `language` text DEFAULT 'typescript' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `size_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `line_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `is_test` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `import_specifiers` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `indexed_head` text;