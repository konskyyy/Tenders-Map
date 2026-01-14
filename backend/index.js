import express from "express";
import cors from "cors";
import pg from "pg";

const app = express();

// ENV
const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DATABASE_URL = process.env.DATABASE_URL;

// Log (pomaga diagnozować)
console.log("CORS_ORIGIN:", CORS_ORIGIN);
console.log("DATABASE_URL set:", Boolean(DATABASE_URL));

app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
    credentials: false,
  })
);
app.use(express.json({ limit: "2mb" }));

// Postgres client pool
const { Pool } = pg;

if (!DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is not set. API will not work without DB.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Neon zwykle wymaga SSL, lokalny docker nie. Robimy auto:
  ssl:
    DATABASE_URL && DATABASE_URL.includes("neon.tech")
      ? { rejectUnauthorized: false }
      : false,
});

// Helpers
function toText(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function toStatus(v) {
  const s = toText(v).trim();
  if (s === "planowany" || s === "przetarg" || s === "realizacja") return s;
  return "planowany";
}

function toNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

// Health
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: "DB error", details: String(e) });
  }
});

// GET points
app.get("/api/points", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, title, note, status, lat, lng, director, winner, created_at
      FROM points
      ORDER BY id DESC
      `
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// POST point
app.post("/api/points", async (req, res) => {
  try {
    const title = toText(req.body.title || "Nowy punkt");
    const note = toText(req.body.note || "");
    const status = toStatus(req.body.status);
    const director = toText(req.body.director || "");
    const winner = toText(req.body.winner || "");
    const lat = toNumber(req.body.lat);
    const lng = toNumber(req.body.lng);

    if (lat === null || lng === null) {
      return res.status(400).json({ error: "Invalid lat/lng" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO points (title, note, status, lat, lng, director, winner)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, title, note, status, lat, lng, director, winner, created_at
      `,
      [title, note, status, lat, lng, director, winner]
    );

    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// PUT point
app.put("/api/points/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const title = toText(req.body.title || "");
    const note = toText(req.body.note || "");
    const status = toStatus(req.body.status);
    const director = toText(req.body.director || "");
    const winner = toText(req.body.winner || "");

    const { rows } = await pool.query(
      `
      UPDATE points
      SET title = $1,
          note = $2,
          status = $3,
          director = $4,
          winner = $5
      WHERE id = $6
      RETURNING id, title, note, status, lat, lng, director, winner, created_at
      `,
      [title, note, status, director, winner, id]
    );

    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// DELETE point
app.delete("/api/points/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    await pool.query(`DELETE FROM points WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend działa na porcie ${PORT}`);
});
