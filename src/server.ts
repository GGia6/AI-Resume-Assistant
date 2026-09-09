import express from "express";
import helmet from "helmet";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import pdf from "pdf-parse";
import { z } from "zod";
import { openDatabase } from "./db.js";
import { analyzeFit, generateCoverLetter, getProfile, saveProfile, safeSubmit } from "./services.js";

const app = express();
const db = openDatabase();
const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const maxMb = Number(process.env.MAX_UPLOAD_MB ?? 5);
const upload = multer({ dest: uploadDir, limits: { fileSize: maxMb * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, file.mimetype === "application/pdf") });
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve("public")));

const profileSchema = z.object({
  fullName: z.string().max(200).optional(), email: z.string().email().or(z.literal("")).optional(),
  phone: z.string().max(50).optional(), location: z.string().max(200).optional(), summary: z.string().max(5000).optional(),
  skills: z.array(z.union([z.string().max(100), z.object({ name: z.string().max(100) })])).max(100).optional(),
  experience: z.array(z.record(z.string())).max(30).optional(), education: z.array(z.record(z.string())).max(30).optional()
});
const jobSchema = z.object({ title: z.string().min(1).max(200), company: z.string().max(200).optional(), location: z.string().max(200).optional(), description: z.string().min(20).max(50000), sourceUrl: z.string().url().or(z.literal("")).optional() });
const error = (res: express.Response, message: string, status = 400) => res.status(status).json({ error: message });

app.get("/api/profile", (_req, res) => res.json(getProfile(db)));
app.put("/api/profile", (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return error(res, parsed.error.issues.map((i) => i.message).join("; "));
  res.json(saveProfile(db, parsed.data));
});
app.post("/api/profile/import", upload.single("resume"), async (req, res) => {
  if (!req.file) return error(res, "A PDF resume is required");
  try {
    const buffer = await fs.promises.readFile(req.file.path);
    const parsed = await pdf(buffer);
    const text = parsed.text.slice(0, 200000);
    const skills = [...new Set((text.match(/\b(JavaScript|TypeScript|Python|Java|React|Node\.?js|SQL|AWS|Docker|Git|Excel|Figma)\b/gi) ?? []).map((s) => s.trim()))];
    const profile = saveProfile(db, { sourceFile: path.basename(req.file.originalname), sourceText: text, summary: text.slice(0, 1500), skills });
    await fs.promises.rm(req.file.path, { force: true });
    res.json({ profile, extractedText: text });
  } catch (e) {
    await fs.promises.rm(req.file.path, { force: true }).catch(() => undefined);
    error(res, e instanceof Error ? e.message : "Unable to read PDF", 422);
  }
});
app.get("/api/criteria", (_req, res) => res.json(db.prepare("SELECT * FROM scoring_criteria ORDER BY id").all()));
app.put("/api/criteria/:id", (req, res) => {
  const body = z.object({ weight: z.number().int().min(0).max(10), enabled: z.boolean() }).safeParse(req.body);
  if (!body.success) return error(res, "Invalid scoring criteria");
  db.prepare("UPDATE scoring_criteria SET weight=?, enabled=? WHERE id=?").run(body.data.weight, body.data.enabled ? 1 : 0, req.params.id);
  res.json(db.prepare("SELECT * FROM scoring_criteria WHERE id=?").get(req.params.id));
});
app.get("/api/jobs", (_req, res) => res.json(db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all()));
app.post("/api/jobs", (req, res) => {
  const parsed = jobSchema.safeParse(req.body);
  if (!parsed.success) return error(res, parsed.error.issues.map((i) => i.message).join("; "));
  const profile = getProfile(db);
  const fit = analyzeFit(parsed.data.description, profile, db.prepare("SELECT * FROM scoring_criteria").all() as any[]);
  const timestamp = new Date().toISOString();
  const result = db.prepare(`INSERT INTO jobs (title,company,location,description,source_url,fit_score,fit_rationale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(parsed.data.title, parsed.data.company ?? "", parsed.data.location ?? "", parsed.data.description, parsed.data.sourceUrl || null, fit.score, JSON.stringify(fit), timestamp, timestamp);
  res.status(201).json(db.prepare("SELECT * FROM jobs WHERE id=?").get(result.lastInsertRowid));
});
app.get("/api/applications", (_req, res) => res.json(db.prepare("SELECT applications.*, jobs.title, jobs.company FROM applications JOIN jobs ON jobs.id=applications.job_id ORDER BY applications.created_at DESC").all()));
app.post("/api/applications", (req, res) => {
  const body = z.object({ jobId: z.number().int().positive(), profileId: z.number().int().positive().optional() }).safeParse(req.body);
  if (!body.success) return error(res, "A valid job is required");
  const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(body.data.jobId) as any;
  if (!job) return error(res, "Job not found", 404);
  const profile = getProfile(db);
  const timestamp = new Date().toISOString();
  const result = db.prepare("INSERT INTO applications (job_id,profile_id,cover_letter,created_at,updated_at) VALUES (?,?,?,?,?)").run(job.id, body.data.profileId ?? profile?.id ?? null, generateCoverLetter(job, profile), timestamp, timestamp);
  res.status(201).json(db.prepare("SELECT * FROM applications WHERE id=?").get(result.lastInsertRowid));
});
app.post("/api/applications/:id/approve", (req, res) => {
  const timestamp = new Date().toISOString();
  db.prepare("UPDATE applications SET approval_at=?, status='approved', updated_at=? WHERE id=?").run(timestamp, timestamp, req.params.id);
  res.json(db.prepare("SELECT * FROM applications WHERE id=?").get(req.params.id));
});
app.post("/api/applications/:id/submit", (req, res) => {
  try { res.json(safeSubmit(db, Number(req.params.id))); } catch (e) { error(res, e instanceof Error ? e.message : "Submission failed", 409); }
});
app.post("/api/applications/:id/responses", (req, res) => {
  const body = z.object({ kind: z.string().min(1).max(50), body: z.string().min(1).max(10000), occurredAt: z.string().datetime().optional() }).safeParse(req.body);
  if (!body.success) return error(res, "Invalid response");
  const result = db.prepare("INSERT INTO responses (application_id,kind,body,occurred_at) VALUES (?,?,?,?)").run(req.params.id, body.data.kind, body.data.body, body.data.occurredAt ?? new Date().toISOString());
  res.status(201).json(db.prepare("SELECT * FROM responses WHERE id=?").get(result.lastInsertRowid));
});
app.get("/api/history", (_req, res) => res.json({ jobs: db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all(), applications: db.prepare("SELECT applications.*, jobs.title, jobs.company FROM applications JOIN jobs ON jobs.id=applications.job_id ORDER BY applications.created_at DESC").all(), responses: db.prepare("SELECT * FROM responses ORDER BY occurred_at DESC").all() }));

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== "test") app.listen(port, () => console.log(`Resume Assistant listening on http://localhost:${port}`));
export default app;
