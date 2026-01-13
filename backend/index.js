const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DB_SSL = (process.env.DB_SSL || "false").toLowerCase() === "true";

console.log("CORS_ORIGIN:", CORS_ORIGIN);
console.log("DATABASE_URL set:", !!process.env.DATABASE_URL);
console.log("DB_SSL:", DB_SSL);

app.use(express.json());

app.use(
  cors(
    CORS_ORIGIN === "*"
      ? { origin: true, credentials: false }
      : { origin: CORS_ORIGIN, credentials: true }
  )
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: DB_SSL ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15000,
});

app.get("/", (req, res) => {
  res.send("API działa. Wejdź na /api/points albo /api/health");
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    console.error("HEALTH ERROR:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get("/api/points", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM points ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (e) {
    console.error("GET /api/points ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.post("/api/points", async (req, res) => {
  const { title, note, status, lat, lng } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO points (title, note, status, lat, lng)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title || "Nowy punkt", note || "", status || "planowany", lat, lng]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error("POST /api/points ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.put("/api/points/:id", async (req, res) => {
  const { id } = req.params;
  const { title, note, status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE points
       SET title=$1, note=$2, status=$3
       WHERE id=$4
       RETURNING *`,
      [title || "", note || "", status || "planowany", id]
    );
    res.json(result.rows[0] || null);
  } catch (e) {
    console.error("PUT /api/points/:id ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.delete("/api/points/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query("DELETE FROM points WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/points/:id ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.listen(PORT, () => {
  console.log("Backend działa na porcie", PORT);
});
