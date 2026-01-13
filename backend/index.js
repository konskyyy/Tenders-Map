import express from "express";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;

const app = express();

/* =======================
   CONFIG
======================= */

const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

console.log("CORS_ORIGIN:", CORS_ORIGIN);
console.log("DATABASE_URL set:", !!process.env.DATABASE_URL);

/* =======================
   MIDDLEWARE
======================= */

app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
);

app.use(express.json());

/* =======================
   DATABASE (Neon)
======================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

/* =======================
   HEALTHCHECK
======================= */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    console.error("HEALTH ERROR:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* =======================
   ROUTES — POINTS
======================= */

// GET all points
app.get("/api/points", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM points ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (e) {
    console.error("GET /points ERROR:", e);
    res.status(500).json({ error: "DB error" });
  }
});

// CREATE point
app.post("/api/points", async (req, res) => {
  const { title, note, status, lat, lng } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO points (title, note, status, lat, lng)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, note, status, lat, lng]
    );

    res.json(result.rows[0]);
  } catch (e) {
    console.error("POST /points ERROR:", e);
    res.status(500).json({ error: "DB error" });
  }
});

// UPDATE point
app.put("/api/points/:id", async (req, res) => {
  const { id } = req.params;
  const { title, note, status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE points
       SET title=$1, note=$2, status=$3
       WHERE id=$4
       RETURNING *`,
      [title, note, status, id]
    );

    res.json(result.rows[0]);
  } catch (e) {
    console.error("PUT /points ERROR:", e);
    res.status(500).json({ error: "DB error" });
  }
});

// DELETE point
app.delete("/api/points/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query("DELETE FROM points WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /points ERROR:", e);
    res.status(500).json({ error: "DB error" });
  }
});

/* =======================
   ROOT
======================= */

app.get("/", (req, res) => {
  res.send("API działa. Wejdź na /api/points");
});

/* =======================
   START
======================= */

app.listen(PORT, () => {
  console.log("Backend działa na porcie", PORT);
});
