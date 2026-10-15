CREATE TABLE `call_bindings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`kind` text NOT NULL,
	`local` text NOT NULL,
	`imported` text NOT NULL,
	`specifier` text,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `call_bindings_file_idx` ON `call_bindings` (`file_id`);--> statement-breakpoint
CREATE TABLE `type_decls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`name` text,
	`kind` text NOT NULL,
	`line` integer NOT NULL,
	`exported` integer DEFAULT false NOT NULL,
	`nested` integer DEFAULT false NOT NULL,
	`extends_refs` text DEFAULT '[]' NOT NULL,
	`implements_refs` text DEFAULT '[]' NOT NULL,
	`test_double_of` text,
	`members` text DEFAULT '[]' NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `type_decls_file_idx` ON `type_decls` (`file_id`);--> statement-breakpoint
CREATE INDEX `type_decls_name_idx` ON `type_decls` (`name`);--> statement-breakpoint
CREATE TABLE `typed_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`line` integer NOT NULL,
	`member` text,
	`receiver` text NOT NULL,
	`ref` text,
	`in_class` text,
	`how` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `typed_calls_file_idx` ON `typed_calls` (`file_id`);--> statement-breakpoint
CREATE INDEX `typed_calls_member_idx` ON `typed_calls` (`member`);