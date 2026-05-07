const express = require("express");
const { Pool } = require("pg");
const redis = require("redis");
const cors = require("cors");
const promClient = require("prom-client");

// ─── OpenTelemetry ─────────────────────────────────────────────────────────────
// require() вызывается ТОЛЬКО если OTLP_ENDPOINT задан — иначе пакеты не нужны
// и сервер запустится без них (трейсинг опционален)
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "";
const SERVICE_NAME  = process.env.OTEL_SERVICE_NAME || "todo-backend";

if (OTLP_ENDPOINT) {
  try {
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
    const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
    const { Resource } = require("@opentelemetry/resources");
    const { SemanticResourceAttributes } = require("@opentelemetry/semantic-conventions");

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
      }),
      traceExporter: new OTLPTraceExporter({ url: `${OTLP_ENDPOINT}/v1/traces` }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk.start();
    console.log(`[tracing] OpenTelemetry enabled → ${OTLP_ENDPOINT}`);
  } catch (err) {
    // Если пакеты не установлены — предупреждение, но сервер НЕ падает
    console.warn(`[tracing] Failed to init OpenTelemetry: ${err.message}`);
    console.warn("[tracing] Run: npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/auto-instrumentations-node @opentelemetry/resources @opentelemetry/semantic-conventions");
  }
} else {
  console.log("[tracing] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled");
}

// ─── Prometheus ────────────────────────────────────────────────────────────────
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

// HTTP counter
const httpRequestsTotal = new promClient.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

// HTTP histogram (latency)
const httpRequestDurationSeconds = new promClient.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Business metric: gauge задач по статусу
const todoTasksGauge = new promClient.Gauge({
  name: "todo_tasks_total",
  help: "Current number of tasks by status",
  labelNames: ["status"],
  registers: [register],
});

// Business metric: created counter
const todoTasksCreated = new promClient.Counter({
  name: "todo_tasks_created_total",
  help: "Total tasks created",
  registers: [register],
});

// Business metric: completed counter
const todoTasksCompleted = new promClient.Counter({
  name: "todo_tasks_completed_total",
  help: "Total tasks marked as completed",
  registers: [register],
});

// ─── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// Middleware: замер каждого запроса (кроме /metrics — чтобы scrape не засорял данные)
app.use((req, res, next) => {
  if (req.path === "/metrics") return next();
  const start = Date.now();
  res.on("finish", () => {
    // Нормализуем путь: /api/tasks/123 → /api/tasks/:id
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, (Date.now() - start) / 1000);
  });
  next();
});

// ─── PostgreSQL ────────────────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST     || "postgres",
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || "todoapp",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "secret",
});

// ─── Redis ─────────────────────────────────────────────────────────────────────
const redisClient = redis.createClient({
  url: `redis://${process.env.REDIS_HOST || "redis"}:${process.env.REDIS_PORT || 6379}`,
});

// ─── Инициализация БД ──────────────────────────────────────────────────────────
const initDB = async (retries = 5, delay = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id         SERIAL PRIMARY KEY,
          title      VARCHAR(255) NOT NULL,
          completed  BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log("Database initialized");
      return;
    } catch (err) {
      console.error(`DB init attempt ${i + 1} failed:`, err.message);
      if (i < retries - 1) await new Promise(r => setTimeout(r, delay));
      else throw new Error("Could not connect to database after retries");
    }
  }
};

// ─── Redis connect ─────────────────────────────────────────────────────────────
const connectRedis = async (retries = 5, delay = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await redisClient.connect();
      await redisClient.ping();
      console.log("Redis connected");
      return;
    } catch (err) {
      console.error(`Redis attempt ${i + 1} failed:`, err.message);
      if (i < retries - 1) await new Promise(r => setTimeout(r, delay));
      else throw new Error("Could not connect to Redis after retries");
    }
  }
};

// ─── Обновление gauge ─────────────────────────────────────────────────────────
const refreshTaskGauge = async () => {
  try {
    const result = await pool.query(
      "SELECT completed, COUNT(*) AS cnt FROM tasks GROUP BY completed"
    );
    let active = 0, done = 0;
    for (const row of result.rows) {
      if (row.completed) done = parseInt(row.cnt);
      else active = parseInt(row.cnt);
    }
    todoTasksGauge.set({ status: "active" },    active);
    todoTasksGauge.set({ status: "completed" }, done);
  } catch (_) {}
};

// ─── Graceful shutdown ─────────────────────────────────────────────────────────
const gracefulShutdown = async () => {
  console.log("Shutting down...");
  try { await redisClient.quit(); } catch (_) {}
  try { await pool.end(); }        catch (_) {}
  process.exit(0);
};
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT",  gracefulShutdown);

// ═══ ROUTES ═══════════════════════════════════════════════════════════════════

// Prometheus scrape endpoint
app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// Health
app.get("/api/health", (_req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Readiness
app.get("/api/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    await redisClient.ping();
    res.json({ status: "ready" });
  } catch (err) {
    res.status(503).json({ status: "not ready", error: err.message });
  }
});

// GET /api/tasks
app.get("/api/tasks", async (_req, res) => {
  try {
    const cached = await redisClient.get("tasks");
    if (cached) return res.json({ tasks: JSON.parse(cached), source: "cache" });
    const result = await pool.query("SELECT * FROM tasks ORDER BY created_at DESC");
    await redisClient.setEx("tasks", 30, JSON.stringify(result.rows));
    res.json({ tasks: result.rows, source: "database" });
  } catch (err) {
    console.error("Error fetching tasks:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks
app.post("/api/tasks", async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });
    const result = await pool.query(
      "INSERT INTO tasks (title) VALUES ($1) RETURNING *", [title]
    );
    await redisClient.del("tasks");
    todoTasksCreated.inc();
    await refreshTaskGauge();
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error adding task:", err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/:id
app.put("/api/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { completed } = req.body;
    const result = await pool.query(
      "UPDATE tasks SET completed = $1 WHERE id = $2 RETURNING *", [completed, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Task not found" });
    await redisClient.del("tasks");
    if (completed) todoTasksCompleted.inc();
    await refreshTaskGauge();
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating task:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id
app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
    await redisClient.del("tasks");
    await refreshTaskGauge();
    res.status(204).send();
  } catch (err) {
    console.error("Error deleting task:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

(async () => {
  try {
    await initDB();
    await connectRedis();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Backend running on port ${PORT}`);
      console.log(`Metrics: http://localhost:${PORT}/metrics`);
    });
  } catch (err) {
    console.error("Failed to start:", err.message);
    process.exit(1);
  }
})();
