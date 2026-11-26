-- Persistent discovered machines; no deletion on source inactivity.
CREATE TABLE md_machine_registry (
 machine_no varchar(20) PRIMARY KEY,
 dp_no text, product_name text, cavity text,
 last_seen date NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON md_machine_registry TO {{APP_ROLE}};
