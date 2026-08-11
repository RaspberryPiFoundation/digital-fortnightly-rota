-- Migration number: 0004 	 2026-08-11T18:05:00.000Z
DROP INDEX IF EXISTS talks_speaker_email_idx;

ALTER TABLE talks DROP COLUMN speaker_email;
