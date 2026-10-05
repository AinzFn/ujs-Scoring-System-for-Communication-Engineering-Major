PRAGMA foreign_keys = ON;

CREATE TABLE super_admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  secret TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE class_admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES class_admins(id) ON DELETE CASCADE
);

CREATE TABLE members (
  class_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (class_id, name),
  UNIQUE (class_id, position),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

CREATE TABLE class_submissions (
  class_id INTEGER NOT NULL,
  rater TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  PRIMARY KEY (class_id, rater),
  FOREIGN KEY (class_id, rater) REFERENCES members(class_id, name) ON DELETE CASCADE
);

INSERT INTO super_admin (id, secret, password_salt, password_hash, created_at)
SELECT 1, secret, password_salt, password_hash, created_at FROM settings WHERE id = 1;

INSERT INTO class_admins (id, name, password_salt, password_hash, created_at)
SELECT 1, '原管理员', password_salt, password_hash, created_at FROM settings WHERE id = 1;

INSERT INTO classes (id, admin_id, name, created_at)
SELECT 1, 1, '原有班级', created_at FROM settings WHERE id = 1;

INSERT INTO members (class_id, position, name)
SELECT 1, position, name FROM roster;

INSERT INTO class_submissions (class_id, rater, submitted_at, scores_json)
SELECT 1, rater, submitted_at, scores_json FROM submissions;
