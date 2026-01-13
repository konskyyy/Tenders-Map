const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// DB
const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT,
});

// Uploads
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = Date.now() + "-" + file.originalname.replace(/\s+/g, "_");
    cb(null, safe);
  },
});
const upload = multer({ storage });

app.use("/uploads", express.static(uploadsDir));

// API
app.get("/api/points", async (req, res) => {
  const result = await pool.query("SELECT * FROM points ORDER BY created_at DESC");
  res.json(result.rows);
});

app.post("/api/points", async (req, res) => {
  const { title, note, status, lat, lng } = req.body;

  const result = await pool.query(
    "INSERT INTO points (title, note, status, lat, lng) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [title, note, status, lat, lng]
  );

  res.json(result.rows[0]);
});

app.post("/api/points/:id/photo", upload.single("photo"), async (req, res) => {
  const pointId = req.params.id;
  const url = `/uploads/${req.file.filename}`;

  await pool.query("INSERT INTO photos (point_id, url) VALUES ($1,$2)", [pointId, url]);
  res.json({ ok: true, url });
});

// Usuń punkt (zdjęcia w DB usuną się automatycznie przez ON DELETE CASCADE)
app.delete("/api/points/:id", async (req, res) => {
  const id = req.params.id;

  await pool.query("DELETE FROM points WHERE id=$1", [id]);

  res.json({ ok: true });
});

// Edytuj punkt
app.put("/api/points/:id", async (req, res) => {
  const id = req.params.id;
  const { title, note, status } = req.body;

  const result = await pool.query(
    "UPDATE points SET title=$1, note=$2, status=$3 WHERE id=$4 RETURNING *",
    [title, note, status, id]
  );

  res.json(result.rows[0]);
});

app.get("/api/points/:id/photos", async (req, res) => {
  const pointId = req.params.id;
  const result = await pool.query("SELECT * FROM photos WHERE point_id=$1 ORDER BY id DESC", [pointId]);
  res.json(result.rows);
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log("Backend działa na porcie", port));
