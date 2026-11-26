-- Calendar overrides; no automatic change to approved utilization formulas.
CREATE TABLE md_work_calendar (
 work_date date PRIMARY KEY,
 day_type text NOT NULL CHECK (day_type IN ('working','holiday','overtime')),
 planned_minutes integer CHECK (planned_minutes BETWEEN 0 AND 1440),
 note varchar(200),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES app_user(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON md_work_calendar TO {{APP_ROLE}};
