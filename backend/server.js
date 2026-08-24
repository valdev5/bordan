require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const { initDb } = require("./src/db/init");
const authRoutes = require("./src/routes/auth");
const bonRoutes = require("./src/routes/bons");
const auditRoutes = require("./src/routes/audit");
const stateRoutes = require("./src/routes/state");
const pushRoutes = require("./src/routes/push");
const calendarTokenRoutes = require("./src/routes/calendarToken");
const calendarFeedRoutes = require("./src/routes/calendarFeed");

const app = express();

const PORT = Number(process.env.PORT || 3001);

initDb();

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

app.use(express.json({ limit: '25mb' }));

app.use("/api/auth", authRoutes);
app.use("/api/bons", bonRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/state", stateRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/calendar", calendarTokenRoutes);
app.use("/calendar", calendarFeedRoutes);

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
