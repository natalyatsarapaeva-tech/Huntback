-- Разбор фактов, коуч и ревью документов (редакция 1.3).

-- Подсказка разбора к факту и то, что пользователь дописал сам.
ALTER TABLE facts ADD COLUMN review TEXT;
ALTER TABLE facts ADD COLUMN user_input TEXT;

-- След ревью документа: раунды проверяющего и число переписываний.
ALTER TABLE documents ADD COLUMN review TEXT;

-- Мастер-резюме — базовое, не под конкретное место; у него нет opportunity_id.
ALTER TABLE profiles ADD COLUMN master_resume TEXT NOT NULL DEFAULT '';

-- Чат с коучем: одна беседа на пользователя.
CREATE TABLE IF NOT EXISTS coach_sessions (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  messages   TEXT NOT NULL DEFAULT '[]',
  proposals  TEXT NOT NULL DEFAULT '[]',
  skipped    TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
