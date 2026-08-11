-- Migration number: 0002 	 2026-08-11T17:15:00.000Z
ALTER TABLE events ADD COLUMN display_date TEXT;
ALTER TABLE events ADD COLUMN cancelled_at TEXT;
ALTER TABLE events ADD COLUMN cancellation_reason TEXT;
