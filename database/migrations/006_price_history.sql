CREATE TABLE md_price_history (
 id bigserial PRIMARY KEY,
 entity_type text NOT NULL CHECK (entity_type IN ('part','material')),
 entity_key text NOT NULL,
 old_price numeric, new_price numeric,
 changed_at timestamptz NOT NULL DEFAULT now(),
 changed_by uuid
);
CREATE INDEX md_price_history_lookup ON md_price_history(entity_type, entity_key, changed_at DESC);
CREATE FUNCTION log_md_price_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'md_part' THEN
  IF OLD.price_per_pcs IS DISTINCT FROM NEW.price_per_pcs THEN
   INSERT INTO md_price_history(entity_type,entity_key,old_price,new_price,changed_by) VALUES ('part',NEW.dp_no,OLD.price_per_pcs,NEW.price_per_pcs,NEW.updated_by);
  END IF;
 ELSE
  IF OLD.price_per_gram IS DISTINCT FROM NEW.price_per_gram THEN
   INSERT INTO md_price_history(entity_type,entity_key,old_price,new_price,changed_by) VALUES ('material',NEW.code,OLD.price_per_gram,NEW.price_per_gram,NEW.updated_by);
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER md_part_price_history AFTER UPDATE ON md_part FOR EACH ROW EXECUTE PROCEDURE log_md_price_change();
CREATE TRIGGER md_material_price_history AFTER UPDATE ON md_material FOR EACH ROW EXECUTE PROCEDURE log_md_price_change();
GRANT SELECT, INSERT ON md_price_history TO {{APP_ROLE}};
GRANT USAGE ON SEQUENCE md_price_history_id_seq TO {{APP_ROLE}};
