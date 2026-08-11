-- Migration number: 0003 	 2026-08-11T17:45:00.000Z
ALTER TABLE talks ADD COLUMN speaker_person_key TEXT;

CREATE INDEX talks_speaker_person_key_idx ON talks(speaker_person_key);
