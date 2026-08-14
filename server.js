// server.js
// Servidor intermediario: recibe archivos desde la web y los deja en cola
// para que el agente en la PC de tu abuela los descargue e imprima.

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Clave secreta compartida entre la web, este servidor y el agente.
// CAMBIALA antes de desplegar. Se puede definir por variable de entorno API_KEY.
const API_KEY = process.env.API_KEY || "cambiar-esta-clave";

const UPLOADS_DIR = path.join(__dirname, "uploads");
const JOBS_FILE = path.join(__dirname, "jobs.json");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(JOBS_FILE)) fs.writeFileSync(JOBS_FILE, "[]");

function readJobs() {
  return JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
}
function writeJobs(jobs) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

// --- Middleware de autenticación simple por clave ---
function checkApiKey(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.key;
  if (key !== API_KEY) {
    return res.status(401).json({ error: "API key inválida" });
  }
  next();
}

// --- Configuración de subida de archivos ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB máx
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Subida de archivo desde la página web
app.post("/api/upload", checkApiKey, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se envió archivo" });

  const jobs = readJobs();
  const job = {
    id: crypto.randomUUID(),
    filename: req.file.filename,
    originalName: req.file.originalname,
    status: "pending", // pending -> printed
    createdAt: new Date().toISOString(),
  };
  jobs.push(job);
  writeJobs(jobs);

  res.json({ ok: true, jobId: job.id });
});

// El agente consulta si hay trabajos pendientes
app.get("/api/jobs/pending", checkApiKey, (req, res) => {
  const jobs = readJobs().filter((j) => j.status === "pending");
  res.json(jobs);
});

// El agente descarga el archivo de un trabajo
app.get("/api/jobs/:id/file", checkApiKey, (req, res) => {
  const jobs = readJobs();
  const job = jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Trabajo no encontrado" });
  const filePath = path.join(UPLOADS_DIR, job.filename);
  res.download(filePath, job.originalName);
});

// El agente confirma que ya imprimió el trabajo
app.post("/api/jobs/:id/ack", checkApiKey, (req, res) => {
  const jobs = readJobs();
  const job = jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Trabajo no encontrado" });

  job.status = "printed";
  job.printedAt = new Date().toISOString();
  writeJobs(jobs);

  // Borramos el archivo físico para no acumular basura
  const filePath = path.join(UPLOADS_DIR, job.filename);
  fs.unlink(filePath, () => {});

  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
