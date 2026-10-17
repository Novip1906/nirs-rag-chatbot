-- +goose Up
ALTER TABLE employees
    ADD COLUMN is_head           boolean NOT NULL DEFAULT false,
    ADD COLUMN invited_at        timestamptz,
    ADD COLUMN invite_expires_at timestamptz,
    ADD COLUMN invited_by        uuid REFERENCES employees (id),
    ADD COLUMN activated_at      timestamptz,
    ADD COLUMN name_confirmed_at timestamptz,
    ADD COLUMN avatar_version    text;
UPDATE employees SET activated_at = created_at;
CREATE INDEX employees_pending_idx ON employees (id) WHERE activated_at IS NULL AND deleted_at IS NULL;

CREATE TABLE employee_avatars (
    employee_id uuid PRIMARY KEY REFERENCES employees (id),
    content     bytea NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    actor_id    uuid REFERENCES employees (id),
    action      text NOT NULL,
    target_type text NOT NULL,
    target_id   uuid NOT NULL,
    details     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id, id DESC);

-- +goose Down
DROP TABLE audit_log;
DROP TABLE employee_avatars;
DROP INDEX employees_pending_idx;
ALTER TABLE employees
    DROP COLUMN avatar_version,
    DROP COLUMN name_confirmed_at,
    DROP COLUMN activated_at,
    DROP COLUMN invited_by,
    DROP COLUMN invite_expires_at,
    DROP COLUMN invited_at,
    DROP COLUMN is_head;
