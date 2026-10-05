PRAGMA foreign_keys = ON;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  secret TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE roster (
  position INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE submissions (
  rater TEXT PRIMARY KEY,
  submitted_at TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  FOREIGN KEY (rater) REFERENCES roster(name) ON DELETE CASCADE
);

CREATE INDEX submissions_time_idx ON submissions(submitted_at);
