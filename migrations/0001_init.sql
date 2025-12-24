-- D1 (SQLite) schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,              -- uuid
  room TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','image','video')),
  content TEXT NOT NULL,            -- text or media url
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room, created_at DESC);
