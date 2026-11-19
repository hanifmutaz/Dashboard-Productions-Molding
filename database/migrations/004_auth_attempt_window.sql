CREATE TABLE auth_attempt_window (
  bucket text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_attempt_window_expires_idx ON auth_attempt_window (expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_attempt_window TO {{APP_ROLE}};
