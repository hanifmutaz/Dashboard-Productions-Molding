ALTER TABLE md_machine_registry ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE md_machine_registry ADD COLUMN label text;
CREATE TABLE md_export_template (
 user_id uuid NOT NULL REFERENCES app_user(id),
 name varchar(80) NOT NULL,
 columns jsonb NOT NULL,
 PRIMARY KEY(user_id,name)
);
CREATE TABLE md_export_history (
 id bigserial PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 filters jsonb NOT NULL,
 row_count integer NOT NULL CHECK(row_count >= 0)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON md_export_template TO {{APP_ROLE}};
GRANT SELECT,INSERT ON md_export_history TO {{APP_ROLE}};
GRANT USAGE ON SEQUENCE md_export_history_id_seq TO {{APP_ROLE}};
CREATE INDEX md_export_history_user ON md_export_history(user_id,created_at DESC);
