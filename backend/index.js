const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json({ limit: "2mb" }));

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: false,
  })
);

const PORT = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

if (!DATABASE_URL) {
  console.log("DATABASE_URL set:", false);
} else {
  console.log("DATABASE_URL set:", true);
}

console.log("CORS_ORIGIN:", CORS_ORIGIN);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && DATABASE_URL.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : false,
});

// --- helpers ---
function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Brak tokenu (Bearer)" });

  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Niepoprawny token" });
  }
}

// --- health ---
app.get("/api/health", async (req, res) => {
  res.json({ ok: true });
});

// --- AUTH ---
app.post("/api/auth/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email i hasło są wymagane" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Hasło musi mieć min. 6 znaków" });
    }

    const hash = await bcrypt.hash(password, 12);
    const q = await pool.query(
      "INSERT INTO users(email, password_hash) VALUES($1,$2) RETURNING id, email",
      [email, hash]
    );

    const user = q.rows[0];
    const token = signToken(user);
    res.json({ token, user });
  } catch (e) {
    // np. duplicate email
    if (String(e).includes("users_email_key") || String(e).includes("duplicate")) {
      return res.status(409).json({ error: "Taki email już istnieje" });
    }
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email i hasło są wymagane" });
    }

    const q = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE email=$1",
      [email]
    );
    const user = q.rows[0];
    if (!user) return res.status(401).json({ error: "Zły email lub hasło" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Zły email lub hasło" });

    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.get("/api/auth/me", authRequired, async (req, res) => {
  res.json({ user: req.user });
});

// --- POINTS ---
// Zakładam, że Twoja tabela points ma kolumny:
// id, title, note, status, lat, lng, created_at, director, winner
// (u Ciebie już są).

app.get("/api/points", authRequired, async (req, res) => {
  try {
    const q = await pool.query(
      "SELECT id, title, note, status, lat, lng, created_at, director, winner FROM points ORDER BY created_at DESC"
    );
    res.json(q.rows);
  } catch (e) {
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.post("/api/points", authRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const title = String(body.title || "Nowy punkt");
    const note = String(body.note || "");
    const status = String(body.status || "planowany");
    const director = String(body.director || "");
    const winner = String(body.winner || "");
    const lat = Number(body.lat);
    const lng = Number(body.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat/lng muszą być liczbami" });
    }

    const q = await pool.query(
      `INSERT INTO points(title, note, status, lat, lng, director, winner)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, title, note, status, lat, lng, created_at, director, winner`,
      [title, note, status, lat, lng, director, winner]
    );

    res.json(q.rows[0]);
  } catch (e) {
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.put("/api/points/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};

    const title = String(body.title ?? "");
    const note = String(body.note ?? "");
    const status = String(body.status ?? "planowany");
    const director = String(body.director ?? "");
    const winner = String(body.winner ?? "");

    const q = await pool.query(
      `UPDATE points
       SET title=$1, note=$2, status=$3, director=$4, winner=$5
       WHERE id=$6
       RETURNING id, title, note, status, lat, lng, created_at, director, winner`,
      [title, note, status, director, winner, id]
    );

    if (!q.rows[0]) return res.status(404).json({ error: "Nie ma takiego punktu" });
    res.json(q.rows[0]);
  } catch (e) {
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.delete("/api/points/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const q = await pool.query("DELETE FROM points WHERE id=$1 RETURNING id", [id]);
    if (!q.rows[0]) return res.status(404).json({ error: "Nie ma takiego punktu" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`Backend działa na porcie ${PORT}`);
});
