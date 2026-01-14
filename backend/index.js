const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json({ limit: "2mb" }));

/**
 * =========================
 * CORS — KLUCZOWA POPRAWKA
 * =========================
 * CORS_ORIGIN w Render ustaw jako:
 * https://tomasz-tenders-map.vercel.app
 * (opcjonalnie też localhost)
 */
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // brak origin (curl, postman)
      if (!origin) return cb(null, true);

      // allowlista z env
      if (allowedOrigins.includes(origin)) return cb(null, true);

      // pozwól na preview z Vercel
      if (origin.endsWith(".vercel.app")) return cb(null, true);

      return cb(new Error("CORS blocked: " + origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

// preflight
app.options("*", cors());

/**
 * =========================
 * CONFIG
 * =========================
 */
const PORT = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

/**
 * =========================
 * DATABASE (Render + Neon)
 * =========================
 */
const pool = new Pool({
  connectionString: DATABASE_URL,
