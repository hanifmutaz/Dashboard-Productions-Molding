-- 001_core.sql  PostgreSQL 9.5 compatible: no identity columns, no declarative partitioning, no extensions.
-- UUIDs are generated in Node. Runs as the DB owner (MIGRATE_DB_USER). {{APP_ROLE}} = runtime role.

CREATE TABLE app_role (
  id uuid PRIMARY KEY,
  name varchar(60) NOT NULL UNIQUE,
  description varchar(200),
  is_system boolean NOT NULL DEFAULT false,
  system_key varchar(20) UNIQUE,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_role_permission (
  role_id uuid NOT NULL REFERENCES app_role(id) ON DELETE CASCADE,
  permission varchar(60) NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY,
  username varchar(64) NOT NULL,
  display_name varchar(120) NOT NULL,
  department varchar(120),
  password_hash text NOT NULL,
  role_id uuid NOT NULL REFERENCES app_role(id),
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_username_chk CHECK (username ~ '^[A-Za-z0-9._-]{3,64}$')
);
CREATE UNIQUE INDEX app_user_username_uq ON app_user (lower(username));

CREATE TABLE app_session (
  id_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  csrf_token char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX app_session_user_idx ON app_session (user_id);

CREATE TABLE user_preference (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  body jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  body jsonb NOT NULL,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_user(id)
);

-- Append-only audit (ADR-020). Runtime role gets INSERT/SELECT only.
CREATE TABLE audit_log (
  id uuid PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_label varchar(120),
  request_id varchar(64),
  action varchar(60) NOT NULL,
  object_type varchar(40),
  object_id varchar(80),
  result varchar(10) NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
  detail jsonb
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, at DESC);

CREATE TABLE kiosk_device (
  id uuid PRIMARY KEY,
  name varchar(60) NOT NULL,
  machine_no varchar(20) NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES app_user(id)
);

CREATE TABLE kiosk_pairing (
  code_hash char(64) PRIMARY KEY,
  name varchar(60) NOT NULL,
  machine_no varchar(20) NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  device_id uuid REFERENCES kiosk_device(id)
);

CREATE TABLE md_material (
  code varchar(40) PRIMARY KEY,
  name varchar(120) NOT NULL,
  price_per_gram numeric(14,4) CHECK (price_per_gram IS NULL OR price_per_gram > 0),
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_user(id)
);

CREATE TABLE md_part (
  dp_no varchar(40) PRIMARY KEY,
  name varchar(120) NOT NULL DEFAULT '',
  price_per_pcs bigint CHECK (price_per_pcs IS NULL OR price_per_pcs >= 0),
  material_code varchar(40) REFERENCES md_material(code),
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_user(id)
);

CREATE TABLE md_stop_category (
  id varchar(30) PRIMARY KEY,
  short_name varchar(60) NOT NULL,
  name varchar(160) NOT NULL,
  loss_group varchar(20) NOT NULL CHECK (loss_group IN ('setup','breakdown','quality','minor','planned')),
  oee_bucket char(1) NOT NULL CHECK (oee_bucket IN ('A','P','-')),
  info_only boolean NOT NULL DEFAULT false,
  color varchar(40) NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  details text[] NOT NULL DEFAULT '{}',
  notes varchar(200),
  sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE, DELETE ON app_role, app_role_permission, app_user, app_session, user_preference, app_settings,
  kiosk_device, kiosk_pairing, md_material, md_part, md_stop_category TO {{APP_ROLE}};
GRANT SELECT, INSERT ON audit_log TO {{APP_ROLE}};
GRANT SELECT ON schema_migration TO {{APP_ROLE}};
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM {{APP_ROLE}};
