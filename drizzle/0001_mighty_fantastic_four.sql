ALTER TABLE `document_drafts` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `evidence_files` ADD `content_hash` text;