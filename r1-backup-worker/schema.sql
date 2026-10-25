CREATE TABLE IF NOT EXISTS seats    (username TEXT PRIMARY KEY, token_hash TEXT NOT NULL, claimed_at INTEGER NOT NULL, blur_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS answers  (username TEXT, qid TEXT, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (username, qid));
CREATE TABLE IF NOT EXISTS flags    (username TEXT, item_id TEXT, PRIMARY KEY (username, item_id));
CREATE TABLE IF NOT EXISTS submitted(username TEXT, part TEXT, at INTEGER NOT NULL, client_completed_at INTEGER, client_time_taken INTEGER, PRIMARY KEY (username, part));
CREATE TABLE IF NOT EXISTS control  (part TEXT PRIMARY KEY, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS questions(part TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS images   (name TEXT PRIMARY KEY, part TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL);
