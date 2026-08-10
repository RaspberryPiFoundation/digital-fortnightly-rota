-- Migration number: 0001 	 2026-08-10T14:51:31.244Z
CREATE TABLE events (
  date TEXT PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT '',
  capacity_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE talks (
  id TEXT PRIMARY KEY,
  event_date TEXT NOT NULL,
  speaker_name TEXT NOT NULL,
  speaker_email TEXT NOT NULL,
  title TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_date) REFERENCES events(date) ON DELETE CASCADE
);

CREATE INDEX talks_event_date_idx ON talks(event_date);
CREATE INDEX talks_speaker_email_idx ON talks(speaker_email);