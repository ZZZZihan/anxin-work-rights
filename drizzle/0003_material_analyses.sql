CREATE TABLE `evidence_analyses` (
	`evidence_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`document_kind` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`run_id` text NOT NULL,
	`job_id` text,
	`result_json` text,
	`error` text,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analyses_user_idx` ON `evidence_analyses` (`user_id`);