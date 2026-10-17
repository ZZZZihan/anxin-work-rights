CREATE TABLE IF NOT EXISTS case_material_fact_cleanup (
    user_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    PRIMARY KEY (user_id, case_id, job_id)
  );
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS facts_cleanup_delete BEFORE DELETE ON case_material_facts
    WHEN CASE WHEN json_valid(OLD.state_json) THEN
      json_type(OLD.state_json,'$.job.id')='text'
      AND length(json_extract(OLD.state_json,'$.job.id')) BETWEEN 1 AND 100
      AND json_extract(OLD.state_json,'$.job.id') NOT GLOB '*[^a-zA-Z0-9_-]*'
      AND json_extract(OLD.state_json,'$.job.id') NOT GLOB 'starting_*'
    ELSE 0 END BEGIN
    INSERT OR IGNORE INTO case_material_fact_cleanup(user_id,case_id,job_id,queued_at)
      VALUES(OLD.user_id,OLD.case_id,json_extract(OLD.state_json,'$.job.id'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS facts_cleanup_replace BEFORE UPDATE OF state_json,user_id,case_id ON case_material_facts
    WHEN CASE WHEN json_valid(OLD.state_json) THEN
      json_type(OLD.state_json,'$.job.id')='text'
      AND length(json_extract(OLD.state_json,'$.job.id')) BETWEEN 1 AND 100
      AND json_extract(OLD.state_json,'$.job.id') NOT GLOB '*[^a-zA-Z0-9_-]*'
      AND json_extract(OLD.state_json,'$.job.id') NOT GLOB 'starting_*'
      AND (OLD.user_id IS NOT NEW.user_id OR OLD.case_id IS NOT NEW.case_id
        OR json_extract(OLD.state_json,'$.job.id') IS NOT
          CASE WHEN json_valid(NEW.state_json) THEN json_extract(NEW.state_json,'$.job.id') END)
    ELSE 0 END BEGIN
    INSERT OR IGNORE INTO case_material_fact_cleanup(user_id,case_id,job_id,queued_at)
      VALUES(OLD.user_id,OLD.case_id,json_extract(OLD.state_json,'$.job.id'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  END;
