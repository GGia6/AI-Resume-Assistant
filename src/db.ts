import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function openDatabase(filename = process.env.DATABASE_PATH ?? "./data/resume-assistant.db") {
  const resolved = path.resolve(filename);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS resume_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
      skills TEXT NOT NULL DEFAULT '[]', experience TEXT NOT NULL DEFAULT '[]',
      education TEXT NOT NULL DEFAULT '[]', source_file TEXT, source_text TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, company TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '', description TEXT NOT NULL, source_url TEXT,
      fit_score INTEGER, fit_rationale TEXT, status TEXT NOT NULL DEFAULT 'saved',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      profile_id INTEGER REFERENCES resume_profiles(id), status TEXT NOT NULL DEFAULT 'draft',
      cover_letter TEXT, approval_at TEXT, submitted_at TEXT, adapter TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, body TEXT NOT NULL, occurred_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scoring_criteria (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.prepare("INSERT OR IGNORE INTO migrations (version, applied_at) VALUES (1, ?)")
    .run(new Date().toISOString());
  const count = db.prepare("SELECT COUNT(*) AS count FROM scoring_criteria").get() as { count: number };
  if (count.count === 0) {
    const insert = db.prepare("INSERT INTO scoring_criteria (name, description, weight) VALUES (?, ?, ?)");
    insert.run("Required skills", "Skills explicitly requested by the job description", 5);
    insert.run("Relevant experience", "Evidence of related experience in the profile", 3);
    insert.run("Location", "Location or remote-work compatibility", 1);
  }
  return db;
}

export type Db = ReturnType<typeof openDatabase>;
