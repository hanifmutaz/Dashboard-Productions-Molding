-- PG 9.5 compatible. Apply on a restored test database before production.
ALTER TABLE md_price_history ADD COLUMN effective_date date;
CREATE INDEX md_price_effective_lookup ON md_price_history(entity_type,entity_key,effective_date DESC,id DESC);
CREATE INDEX md_price_effective_date ON md_price_history(effective_date) WHERE effective_date IS NOT NULL;
CREATE TABLE md_part_material_history (
 id bigserial PRIMARY KEY, dp_no text NOT NULL, material_code text,
 effective_date date NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(), changed_by uuid
);
CREATE INDEX md_mapping_lookup ON md_part_material_history(upper(btrim(dp_no)),effective_date DESC,id DESC);
INSERT INTO md_part_material_history(dp_no,material_code,effective_date,changed_by)
SELECT dp_no,material_code,(now() AT TIME ZONE 'Asia/Jakarta')::date,updated_by FROM md_part;
CREATE FUNCTION log_md_mapping_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO md_part_material_history(dp_no,material_code,effective_date,changed_by) VALUES(NEW.dp_no,NEW.material_code,(now() AT TIME ZONE 'Asia/Jakarta')::date,NEW.updated_by);
 ELSIF OLD.material_code IS DISTINCT FROM NEW.material_code THEN
  INSERT INTO md_part_material_history(dp_no,material_code,effective_date,changed_by) VALUES(NEW.dp_no,NEW.material_code,(now() AT TIME ZONE 'Asia/Jakarta')::date,NEW.updated_by);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER md_part_material_change AFTER INSERT OR UPDATE ON md_part FOR EACH ROW EXECUTE PROCEDURE log_md_mapping_change();
CREATE TABLE md_shift_calendar (
 work_date date NOT NULL, shift varchar(1) NOT NULL CHECK(shift IN ('1','2','3')),
 day_type text NOT NULL CHECK(day_type IN ('working','holiday','overtime')),
 planned_minutes integer NOT NULL CHECK(planned_minutes BETWEEN 0 AND 1440),
 note varchar(200) NOT NULL DEFAULT '', updated_by uuid REFERENCES app_user(id),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(work_date,shift),
 CHECK(day_type <> 'holiday' OR planned_minutes=0)
);
CREATE TABLE md_quality_review (
 id bigserial PRIMARY KEY, captured_at timestamptz NOT NULL DEFAULT now(),
 date_from date NOT NULL,date_to date NOT NULL,shift varchar(1),metrics jsonb NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','resolved')),
 note varchar(500), reviewed_by uuid REFERENCES app_user(id),reviewed_at timestamptz
);
CREATE INDEX md_quality_review_time ON md_quality_review(captured_at DESC);
CREATE TABLE md_performance_snapshot (
 bucket timestamptz PRIMARY KEY, metrics jsonb NOT NULL
);
CREATE TABLE md_source_snapshot (
 scope text PRIMARY KEY, captured_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL
);
CREATE INDEX md_source_snapshot_age ON md_source_snapshot(captured_at);
ALTER TABLE md_machine_registry ADD COLUMN inactive_from date;
GRANT SELECT,INSERT ON md_part_material_history TO {{APP_ROLE}};
GRANT SELECT,INSERT,UPDATE ON md_shift_calendar,md_quality_review,md_performance_snapshot TO {{APP_ROLE}};
GRANT DELETE ON md_performance_snapshot TO {{APP_ROLE}};
GRANT SELECT,INSERT,UPDATE,DELETE ON md_source_snapshot TO {{APP_ROLE}};
GRANT USAGE ON SEQUENCE md_part_material_history_id_seq,md_quality_review_id_seq TO {{APP_ROLE}};
-- Explicit operator-reviewed additive records; never infer independent production from DP/PO alone.
CREATE TABLE md_production_record_policy (
 work_date date NOT NULL,machine_no varchar(20) NOT NULL,shift varchar(1) NOT NULL CHECK(shift IN ('1','2','3')),
 observed_ids jsonb NOT NULL,selected_ids jsonb NOT NULL,note varchar(500) NOT NULL,
 updated_by uuid REFERENCES app_user(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(work_date,machine_no,shift)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON md_production_record_policy TO {{APP_ROLE}};
CREATE TABLE md_machine_lifecycle (
 id bigserial PRIMARY KEY,machine_no varchar(20) NOT NULL,effective_date date NOT NULL,active boolean NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX md_machine_lifecycle_lookup ON md_machine_lifecycle(machine_no,effective_date DESC,id DESC);
INSERT INTO md_machine_lifecycle(machine_no,effective_date,active)
SELECT machine_no,(now() AT TIME ZONE 'Asia/Jakarta')::date,active FROM md_machine_registry;
CREATE FUNCTION log_machine_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO md_machine_lifecycle(machine_no,effective_date,active) VALUES(NEW.machine_no,(now() AT TIME ZONE 'Asia/Jakarta')::date,NEW.active);
 ELSIF NEW.active IS DISTINCT FROM OLD.active THEN
  INSERT INTO md_machine_lifecycle(machine_no,effective_date,active) VALUES(NEW.machine_no,(now() AT TIME ZONE 'Asia/Jakarta')::date,NEW.active);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER md_machine_lifecycle_change AFTER INSERT OR UPDATE ON md_machine_registry FOR EACH ROW EXECUTE PROCEDURE log_machine_lifecycle();
GRANT SELECT,INSERT ON md_machine_lifecycle TO {{APP_ROLE}};
GRANT USAGE ON SEQUENCE md_machine_lifecycle_id_seq TO {{APP_ROLE}};
