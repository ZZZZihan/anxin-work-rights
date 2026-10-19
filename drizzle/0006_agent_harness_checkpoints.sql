CREATE TABLE `agent_harness_checkpoint_writes` (
	`owner_id` text NOT NULL,
	`case_id` text NOT NULL,
	`run_id` text NOT NULL,
	`checkpoint_ns` text NOT NULL,
	`checkpoint_id` text NOT NULL,
	`task_id` text NOT NULL,
	`write_index` integer NOT NULL,
	`task_path` text NOT NULL,
	`channel` text NOT NULL,
	`value_type` text NOT NULL,
	`value` blob NOT NULL,
	PRIMARY KEY(`owner_id`, `case_id`, `run_id`, `checkpoint_ns`, `checkpoint_id`, `task_id`, `write_index`)
);
--> statement-breakpoint
CREATE TABLE `agent_harness_checkpoints` (
	`owner_id` text NOT NULL,
	`case_id` text NOT NULL,
	`run_id` text NOT NULL,
	`checkpoint_ns` text NOT NULL,
	`checkpoint_id` text NOT NULL,
	`parent_checkpoint_id` text,
	`checkpoint_type` text NOT NULL,
	`checkpoint` blob NOT NULL,
	`metadata_type` text NOT NULL,
	`metadata` blob NOT NULL,
	PRIMARY KEY(`owner_id`, `case_id`, `run_id`, `checkpoint_ns`, `checkpoint_id`)
);
