-- migrations/001_schema.sql
-- Jalankan: bun run d1:init (production) atau bun run d1:local (dev)

PRAGMA foreign_keys = ON;

-- Pakar / annotator
CREATE TABLE IF NOT EXISTS experts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  institution TEXT DEFAULT '',
  expertise   TEXT DEFAULT '',
  invite_code TEXT UNIQUE NOT NULL,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Dokumen putusan
CREATE TABLE IF NOT EXISTS documents (
  id                  TEXT PRIMARY KEY,
  tingkat_pengadilan  TEXT,
  tahun               TEXT,
  jenis_perkara       TEXT,
  amar_putusan        TEXT,
  text_length         INTEGER DEFAULT 0,
  extraction_score    REAL,
  isi_putusan         TEXT NOT NULL DEFAULT '',
  metadata_json       TEXT DEFAULT '{}',
  created_at          TEXT DEFAULT (datetime('now'))
);

-- Parameter HAM dari knowledge base
CREATE TABLE IF NOT EXISTS ham_parameters (
  id                        TEXT PRIMARY KEY,
  kategori                  TEXT NOT NULL,
  sub_kategori              TEXT NOT NULL,
  kaidah_hukum              TEXT NOT NULL,
  prinsip_ham               TEXT DEFAULT '',
  dasar_hukum_nasional      TEXT DEFAULT '[]',
  dasar_hukum_internasional TEXT DEFAULT '[]',
  kata_kunci                TEXT DEFAULT '[]',
  landmark_id               TEXT
);

-- Anotasi oleh pakar
CREATE TABLE IF NOT EXISTS annotations (
  id                              TEXT PRIMARY KEY,
  document_id                     TEXT NOT NULL REFERENCES documents(id),
  expert_id                       TEXT NOT NULL REFERENCES experts(id),
  overall_rating                  INTEGER CHECK(overall_rating BETWEEN 1 AND 5),
  overall_notes                   TEXT DEFAULT '',
  ham_parameters_found            TEXT DEFAULT '[]',
  ham_compliance_score            INTEGER DEFAULT 50 CHECK(ham_compliance_score BETWEEN 0 AND 100),
  missing_considerations          TEXT DEFAULT '',
  fair_trial_addressed            INTEGER DEFAULT 0,
  non_discrimination_addressed    INTEGER DEFAULT 0,
  freedom_expression_addressed    INTEGER DEFAULT 0,
  due_process_addressed           INTEGER DEFAULT 0,
  recommendation                  TEXT CHECK(recommendation IN ('exemplary','adequate','needs_improvement','non_compliant') OR recommendation IS NULL),
  suggested_citations             TEXT DEFAULT '',
  status                          TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','flagged')),
  time_spent_minutes              INTEGER DEFAULT 0,
  created_at                      TEXT DEFAULT (datetime('now')),
  updated_at                      TEXT DEFAULT (datetime('now')),
  UNIQUE(document_id, expert_id)
);

-- Session tokens
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  expert_id   TEXT NOT NULL REFERENCES experts(id),
  created_at  TEXT DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  expert_id   TEXT,
  action      TEXT NOT NULL,
  document_id TEXT,
  detail      TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_annotations_expert ON annotations(expert_id);
CREATE INDEX IF NOT EXISTS idx_annotations_doc ON annotations(document_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expert ON sessions(expert_id);
CREATE INDEX IF NOT EXISTS idx_audit_expert ON audit_log(expert_id);
