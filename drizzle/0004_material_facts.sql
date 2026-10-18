CREATE TABLE IF NOT EXISTS case_material_generations (
    case_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 1 CHECK(generation > 0)
  );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS case_material_facts (
    case_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS material_facts_user_idx ON case_material_facts (user_id);
--> statement-breakpoint
INSERT OR IGNORE INTO case_material_generations (case_id,user_id,generation) SELECT id,user_id,1 FROM cases;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS facts_case_insert AFTER INSERT ON cases BEGIN
    INSERT INTO case_material_generations(case_id,user_id,generation) VALUES(NEW.id,NEW.user_id,1)
    ON CONFLICT(case_id) DO UPDATE SET user_id=excluded.user_id,generation=generation+1;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS facts_case_change AFTER UPDATE ON cases
    WHEN NEW.company IS NOT OLD.company OR NEW.user_id IS NOT OLD.user_id
      OR (NEW.status='archived') != (OLD.status='archived') BEGIN
    UPDATE case_material_generations SET generation=generation+1,user_id=NEW.user_id WHERE case_id=NEW.id;
    DELETE FROM case_material_facts WHERE case_id=NEW.id;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS facts_case_delete AFTER DELETE ON cases BEGIN
    DELETE FROM case_material_facts WHERE case_id=OLD.id;
    UPDATE case_material_generations SET generation=generation+1 WHERE case_id=OLD.id;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS facts_evidence_insert AFTER INSERT ON evidence_files BEGIN
    UPDATE case_material_generations SET generation=generation+1 WHERE case_id=NEW.case_id;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS facts_evidence_update AFTER UPDATE ON evidence_files BEGIN
    UPDATE case_material_generations SET generation=generation+1 WHERE case_id=NEW.case_id OR case_id=OLD.case_id;
    DELETE FROM case_material_facts WHERE (case_id=NEW.case_id OR case_id=OLD.case_id)
      AND (NEW.status='deleting' OR NEW.content_hash IS NOT OLD.content_hash OR NEW.case_id IS NOT OLD.case_id OR NEW.user_id IS NOT OLD.user_id);
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS facts_evidence_delete AFTER DELETE ON evidence_files BEGIN
    UPDATE case_material_generations SET generation=generation+1 WHERE case_id=OLD.case_id;
    DELETE FROM case_material_facts WHERE case_id=OLD.case_id;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS facts_analysis_insert AFTER INSERT ON evidence_analyses BEGIN
    UPDATE case_material_generations SET generation=generation+1
      WHERE case_id IN (SELECT case_id FROM evidence_files WHERE id=NEW.evidence_id);
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS facts_analysis_update AFTER UPDATE ON evidence_analyses BEGIN
    UPDATE case_material_generations SET generation=generation+1
      WHERE case_id IN (SELECT case_id FROM evidence_files WHERE id=NEW.evidence_id OR id=OLD.evidence_id);
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS facts_analysis_delete AFTER DELETE ON evidence_analyses BEGIN
    UPDATE case_material_generations SET generation=generation+1
      WHERE case_id IN (SELECT case_id FROM evidence_files WHERE id=OLD.evidence_id);
    DELETE FROM case_material_facts WHERE case_id IN (SELECT case_id FROM evidence_files WHERE id=OLD.evidence_id);
  END;
