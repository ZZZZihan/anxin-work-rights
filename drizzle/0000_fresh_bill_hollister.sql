CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`company` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`current_step` integer DEFAULT 0 NOT NULL,
	`next_action` text NOT NULL,
	`deadline` text,
	`location` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cases_user_idx` ON `cases` (`user_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`case_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_user_idx` ON `chat_messages` (`user_id`);--> statement-breakpoint
CREATE INDEX `chat_case_idx` ON `chat_messages` (`case_id`);--> statement-breakpoint
CREATE TABLE `document_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`case_id` text NOT NULL,
	`type` text NOT NULL,
	`fields_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_user_idx` ON `document_drafts` (`user_id`);--> statement-breakpoint
CREATE INDEX `documents_case_idx` ON `document_drafts` (`case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_owner_case_type_idx` ON `document_drafts` (`user_id`,`case_id`,`type`);--> statement-breakpoint
CREATE TABLE `evidence_files` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`case_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`mime_type` text NOT NULL,
	`status` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`object_key` text,
	`uploaded_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidence_user_idx` ON `evidence_files` (`user_id`);--> statement-breakpoint
CREATE INDEX `evidence_case_idx` ON `evidence_files` (`case_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`seeded_at` text NOT NULL
);
