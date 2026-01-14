const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json({ limit: "2mb" }));

/**
 * CORS:
 * Ustaw w Render env:
 * CORS_ORIGIN = https://tomasz-tenders-map.vercel.app
 * (opcjonalnie: dodaj też localhost i inne domeny po przecinku)
 */
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/postman
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (origin.endsWith(".vercel.app")) return cb(null, true); // preview Vercel
      return cb(new Error("CORS blocked: " + origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

app.options("*", cors());

const PORT = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ===== HEALTH =====
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// ===== AUTH =====
function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "30d",
  });
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Brak tokenu" });

  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (e) {
    console.error("AUTH TOKEN ERROR:", e);
    return res.status(401).json({ error: "Niepoprawny token" });
  }
}

// ===== REGISTER (disabled) =====
app.post("/api/auth/register", (req, res) => {
  return res.status(403).json({ error: "Rejestracja jest wyłączona" });
});

// ===== LOGIN =====
app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const q = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE email=$1",
      [email]
    );

    const user = q.rows[0];
    if (!user) return res.status(401).json({ error: "Złe dane" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Złe dane" });

    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error("LOGIN DB ERROR:", e);
    return res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.get("/api/auth/me", authRequired, (req, res) => {
  res.json({ user: req.user });
});

/**
 * ===== POINTS API =====
 * Zakładamy tabelę:
 *
 * CREATE TABLE points (
 *   id SERIAL PRIMARY KEY,
 *   title TEXT NOT NULL,
 *   director TEXT,
 *   winner TEXT,
 *   note TEXT,
 *   status TEXT NOT NULL DEFAULT 'planowany',
 *   lat DOUBLE PRECISION NOT NULL,
 *   lng DOUBLE PRECISION NOT NULL,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 */

// GET all points
app.get("/api/points", authRequired, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, title, director, winner, note, status, lat, lng
       FROM points
       ORDER BY id DESC`
    );
    res.json(q.rows);
  } catch (e) {
    console.error("GET POINTS ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// CREATE point
app.post("/api/points", authRequired, async (req, res) => {
  try {
    const title = String(req.body.title || "Nowy punkt");
    const director = String(req.body.director || "");
    const winner = String(req.body.winner || "");
    const note = String(req.body.note || "");
    const status = String(req.body.status || "planowany");
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "Brak poprawnych współrzędnych" });
    }

    const q = await pool.query(
      `INSERT INTO points (title, director, winner, note, status, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, title, director, winner, note, status, lat, lng`,
      [title, director, winner, note, status, lat, lng]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("CREATE POINT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// UPDATE point
app.put("/api/points/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Złe ID" });

    const title = String(req.body.title || "");
    const director = String(req.body.director || "");
    const winner = String(req.body.winner || "");
    const note = String(req.body.note || "");
    const status = String(req.body.status || "planowany");

    const q = await pool.query(
      `UPDATE points
       SET title=$1, director=$2, winner=$3, note=$4, status=$5
       WHERE id=$6
       RETURNING id, title, director, winner, note, status, lat, lng`,
      [title, director, winner, note, status, id]
    );

    const row = q.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono punktu" });

    res.json(row);
  } catch (e) {
    console.error("UPDATE POINT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// DELETE point
app.delete("/api/points/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Złe ID" });

    const q = await pool.query(`DELETE FROM points WHERE id=$1 RETURNING id`, [
      id,
    ]);

    const row = q.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono punktu" });

    res.json({ ok: true, id: row.id });
  } catch (e) {
    console.error("DELETE POINT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`Backend działa na porcie ${PORT}`);
  console.log("CORS_ORIGIN:", process.env.CORS_ORIGIN);
  console.log("DATABASE_URL set:", !!DATABASE_URL);
});
