import type { Db } from "./db.js";

const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value ?? []);
const parse = (value: string) => {
  try { return JSON.parse(value); } catch { return []; }
};

export function profileFromRow(row: any) {
  if (!row) return null;
  return { ...row, skills: parse(row.skills), experience: parse(row.experience), education: parse(row.education) };
}

export function getProfile(db: Db) {
  return profileFromRow(db.prepare("SELECT * FROM resume_profiles ORDER BY id DESC LIMIT 1").get());
}

export function saveProfile(db: Db, input: any) {
  const existing = getProfile(db);
  const timestamp = now();
  const values = [input.fullName ?? "", input.email ?? "", input.phone ?? "", input.location ?? "",
    input.summary ?? "", json(input.skills), json(input.experience), json(input.education),
    input.sourceFile ?? null, input.sourceText ?? null, timestamp];
  if (existing) {
    db.prepare(`UPDATE resume_profiles SET full_name=?,email=?,phone=?,location=?,summary=?,skills=?,experience=?,education=?,source_file=?,source_text=?,updated_at=? WHERE id=?`)
      .run(...values, existing.id);
    return profileFromRow(db.prepare("SELECT * FROM resume_profiles WHERE id=?").get(existing.id));
  }
  const result = db.prepare(`INSERT INTO resume_profiles
    (full_name,email,phone,location,summary,skills,experience,education,source_file,source_text,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values, timestamp);
  return profileFromRow(db.prepare("SELECT * FROM resume_profiles WHERE id=?").get(result.lastInsertRowid));
}

const stopWords = new Set([
  "a", "about", "across", "after", "all", "and", "are", "as", "at", "be", "been", "being",
  "by", "can", "could", "data", "for", "from", "get", "getting", "give", "has", "have",
  "into", "is", "it", "its", "job", "more", "of", "on", "or", "our", "role", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "to", "us", "use",
  "using", "we", "what", "when", "which", "who", "will", "with", "would", "you", "your",
  "enjoy", "help", "helping", "like", "love", "looking", "work", "working"
]);
const terms = (text: string) => [...new Set((text.toLowerCase().match(/[a-z][a-z0-9+#.-]{1,}/g) ?? [])
  .filter((term) => term.length > 2 && !stopWords.has(term)))];

export function analyzeFit(description: string, profile: any, criteria: any[]) {
  const skillAliases: Record<string, string[]> = {
    analytics: ["analytics", "analytical", "analysis", "analyze", "analyzed", "statistical", "statistics"],
    communication: ["communication", "communicating", "communicator", "written", "verbal"],
    insights: ["insight", "insights"],
    "problem-solving": ["problem-solving", "problem solving", "problem"],
    "data visualization": ["visualization", "visualizations", "tableau", "shiny"],
    "data analysis": ["data analysis", "analyzed", "analysis", "data"],
    "business value": ["business value", "business results", "business growth"],
    "computer science": ["computer science", "programming", "python", "r programming"],
    statistics: ["statistics", "statistical", "regression", "ordinal logistic"],
    "data tools": ["analytics technologies", "tableau", "python", "r", "shiny", "spss", "pandas"]
  };
  const resumeText = [
    profile?.source_text,
    ...(profile?.skills ?? []).map((s: any) => typeof s === "string" ? s : s.name),
    profile?.summary,
    ...(profile?.experience ?? []).flatMap((item: any) => Object.values(item)),
    ...(profile?.education ?? []).flatMap((item: any) => Object.values(item))
  ].filter(Boolean).join(" ").toLowerCase();
  const jobTerms = terms(description).filter((term) => term !== "description");
  const meaningfulTerms = jobTerms.filter((term) => term.length > 3);
  const matched = meaningfulTerms.filter((term) => resumeText.includes(term) ||
    Object.values(skillAliases).some((aliases) => aliases.includes(term) && aliases.some((alias) => resumeText.includes(alias))));
  const matchedCategories = Object.entries(skillAliases)
    .filter(([_, aliases]) => aliases.some((alias) => resumeText.includes(alias) && aliases.some((candidate) => description.toLowerCase().includes(candidate))))
    .map(([category]) => category);
  const allMatched = [...new Set([...matched, ...matchedCategories])];
  const required = criteria.filter((c) => c.enabled);
  const skillWeight = required.find((c) => c.name === "Required skills")?.weight ?? 5;
  const score = Math.min(100, Math.round((allMatched.length / Math.max(1, Math.min(meaningfulTerms.length, 16))) * 100 * Math.min(1.5, skillWeight / 5)));
  const missing = meaningfulTerms.filter((term) => !allMatched.includes(term)).slice(0, 8);
  return { score, rationale: `Matched ${allMatched.length} relevant profile terms (${allMatched.slice(0, 8).join(", ") || "none"}).${missing.length ? ` Consider strengthening: ${missing.join(", ")}.` : " Strong keyword alignment."}`, matched: allMatched, missing };
}

export function generateCoverLetter(job: any, profile: any) {
  const name = profile?.full_name || profile?.fullName || "Applicant";
  const skills = (profile?.skills ?? []).slice(0, 5).map((s: any) => typeof s === "string" ? s : s.name).join(", ");
  return `Dear ${job.company || "Hiring Team"},\n\nI am excited to apply for the ${job.title} role. My background and skills in ${skills || "the capabilities described in the role"} align well with your needs. ${profile?.summary || "I bring a thoughtful, results-oriented approach and a strong interest in contributing to your team."}\n\nI would welcome the opportunity to discuss how I can contribute. Thank you for your consideration.\n\nSincerely,\n${name}`;
}

export function safeSubmit(db: Db, applicationId: number) {
  const application = db.prepare("SELECT * FROM applications WHERE id=?").get(applicationId) as any;
  if (!application) throw new Error("Application not found");
  if (!application.approval_at) throw new Error("Explicit approval is required before submission");
  const timestamp = now();
  db.prepare("UPDATE applications SET status='submitted', submitted_at=?, adapter='mock-safe-adapter', updated_at=? WHERE id=?").run(timestamp, timestamp, applicationId);
  return db.prepare("SELECT * FROM applications WHERE id=?").get(applicationId);
}
