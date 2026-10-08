CREATE TABLE `evidence_upload_cancellations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text,
	`cancelled_at` text NOT NULL
);
