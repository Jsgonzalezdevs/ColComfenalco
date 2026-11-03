PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES members(user_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
  block TEXT NOT NULL CHECK (length(trim(block)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX IF NOT EXISTS locations_name_unique ON locations(lower(trim(name)));
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
  position TEXT NOT NULL CHECK (length(trim(position)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX IF NOT EXISTS people_name_unique ON people(lower(trim(name)));

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  plate TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
  category TEXT NOT NULL,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL CHECK (status IN ('Por validar','Bueno','Regular','Deteriorado','No encontrado','Pendiente de baja')),
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  last_action TEXT NOT NULL,
  action_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  review_due_date TEXT,
  last_reviewed_at TEXT,
  source_entry_id TEXT UNIQUE,
  source_document_id TEXT,
  source_data TEXT,
  CHECK (plate IS NULL OR quantity = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS assets_plate_unique ON assets(lower(trim(plate))) WHERE plate IS NOT NULL AND trim(plate) <> '';
CREATE INDEX IF NOT EXISTS assets_location_idx ON assets(location_id);
CREATE INDEX IF NOT EXISTS assets_person_idx ON assets(person_id);
CREATE INDEX IF NOT EXISTS assets_review_due_idx ON assets(review_due_date);
CREATE INDEX IF NOT EXISTS assets_source_document_idx ON assets(source_document_id);

CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  asset_name TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  before TEXT,
  after TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_asset_idx ON movements(asset_id);
CREATE INDEX IF NOT EXISTS movements_created_idx ON movements(created_at);

CREATE TABLE IF NOT EXISTS archive_documents (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  format TEXT NOT NULL,
  category TEXT NOT NULL,
  entry_count INTEGER NOT NULL,
  extraction_status TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE(path, sha256)
);
CREATE INDEX IF NOT EXISTS archive_documents_path_idx ON archive_documents(path);
CREATE TABLE IF NOT EXISTS archive_entries (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES archive_documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  locator TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  text TEXT NOT NULL,
  UNIQUE(document_id, ordinal)
);
CREATE INDEX IF NOT EXISTS archive_entries_kind_idx ON archive_entries(kind);
CREATE INDEX IF NOT EXISTS archive_entries_document_ordinal_idx ON archive_entries(document_id, ordinal);
CREATE TABLE IF NOT EXISTS asset_documents (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  archive_document_id TEXT REFERENCES archive_documents(id),
  storage_path TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  preview_text TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(asset_id, archive_document_id)
);
CREATE INDEX IF NOT EXISTS asset_documents_asset_idx ON asset_documents(asset_id);

-- Cloudflare D1 limits a single row to 2 MB. Files are stored as base64 text
-- in smaller independently decodable chunks so originals remain in D1.
CREATE TABLE IF NOT EXISTS file_chunks (
  file_key TEXT NOT NULL,
  part INTEGER NOT NULL,
  content_base64 TEXT NOT NULL,
  PRIMARY KEY(file_key, part)
);
