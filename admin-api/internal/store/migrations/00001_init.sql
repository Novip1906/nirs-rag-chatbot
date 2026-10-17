-- +goose Up
CREATE TABLE departments (
    id          uuid PRIMARY KEY,
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);
CREATE UNIQUE INDEX departments_name_key ON departments (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX departments_updated_at_idx ON departments (updated_at);

CREATE TABLE employees (
    id            uuid PRIMARY KEY,
    keycloak_sub  text NOT NULL,
    email         text NOT NULL,
    first_name    text NOT NULL,
    last_name     text NOT NULL,
    position      text NOT NULL DEFAULT '',
    department_id uuid REFERENCES departments (id),
    is_admin      boolean NOT NULL DEFAULT false,
    blocked       boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE UNIQUE INDEX employees_sub_key ON employees (keycloak_sub);
CREATE UNIQUE INDEX employees_email_key ON employees (email) WHERE deleted_at IS NULL;
CREATE INDEX employees_updated_at_idx ON employees (updated_at);
CREATE INDEX employees_department_idx ON employees (department_id) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE employees;
DROP TABLE departments;
