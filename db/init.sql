CREATE TABLE IF NOT EXISTS points (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  director TEXT,
  winner TEXT,
  note TEXT,
  status TEXT DEFAULT 'planowany',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- jeśli tabela już istnieje, dołóż brakujące kolumny
ALTER TABLE points ADD COLUMN IF NOT EXISTS director TEXT;
ALTER TABLE points ADD COLUMN IF NOT EXISTS winner TEXT;
-- USERS (logowanie)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
