-- Capture an auditable baseline only from the day this migration runs; never backdate today's price.
-- Existing update triggers (006) remain installed.
INSERT INTO md_price_history(entity_type, entity_key, old_price, new_price, changed_by)
SELECT 'part', p.dp_no, NULL, p.price_per_pcs, p.updated_by FROM md_part p
WHERE NOT EXISTS (SELECT 1 FROM md_price_history h WHERE h.entity_type='part' AND h.entity_key=p.dp_no);
INSERT INTO md_price_history(entity_type, entity_key, old_price, new_price, changed_by)
SELECT 'material', m.code, NULL, m.price_per_gram, m.updated_by FROM md_material m
WHERE NOT EXISTS (SELECT 1 FROM md_price_history h WHERE h.entity_type='material' AND h.entity_key=m.code);

CREATE FUNCTION log_md_price_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'md_part' THEN
  INSERT INTO md_price_history(entity_type,entity_key,old_price,new_price,changed_by)
  VALUES ('part',NEW.dp_no,NULL,NEW.price_per_pcs,NEW.updated_by);
 ELSE
  INSERT INTO md_price_history(entity_type,entity_key,old_price,new_price,changed_by)
  VALUES ('material',NEW.code,NULL,NEW.price_per_gram,NEW.updated_by);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER md_part_price_insert AFTER INSERT ON md_part FOR EACH ROW EXECUTE PROCEDURE log_md_price_insert();
CREATE TRIGGER md_material_price_insert AFTER INSERT ON md_material FOR EACH ROW EXECUTE PROCEDURE log_md_price_insert();
CREATE INDEX md_price_history_time ON md_price_history(changed_at, id);
