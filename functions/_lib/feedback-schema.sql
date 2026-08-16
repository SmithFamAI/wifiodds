-- Product feedback intake. Applied to the wifiodds-feedback D1 database
-- (id d1bddd31-8091-4a2d-950b-1ee11ad28a0c). Pages must bind it as FEEDBACK_DB.
-- Screenshots go to R2 bucket wifiodds-feedback-shots, bound as FEEDBACK_SHOTS.
--
-- This is not the inflight WiFi report store. /api/report is a different pipe.

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread',
  name TEXT,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  send_copy INTEGER NOT NULL DEFAULT 0,
  allow_followup INTEGER NOT NULL DEFAULT 0,
  copy_sent INTEGER NOT NULL DEFAULT 0,
  screenshots_json TEXT NOT NULL DEFAULT '[]',
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);

CREATE TABLE IF NOT EXISTS rate_buckets (
  ip_hash TEXT PRIMARY KEY,
  seen INTEGER NOT NULL,
  cap INTEGER NOT NULL
);
