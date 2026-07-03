require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const authRoutes = require("./src/routes/auth");
const bonRoutes = require("./src/routes/bons");
const auditRoutes = require("./src/routes/audit");

const app = express();

const PORT = Number(process.env.PORT || 3001);

// CORS DEV: autorise 127.0.0.1 + localhost sur ports courants + variables d'env
const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:8000",
  "http://localhost:8000",
]);

const extraOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
for (const origin of extraOrigins) allowedOrigins.add(origin);

app.use(
  cors({
    origin(origin, cb) {
      // autorise curl/postman (pas d'origin)
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/bons", bonRoutes);
app.use("/api/audit", auditRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Sert le frontend HTML/CSS/JS depuis le dossier public
app.use(express.static(path.join(__dirname, "public")));

// Page d'accueil
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API running on http://127.0.0.1:${PORT}`);
});
