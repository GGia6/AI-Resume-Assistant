import { describe, expect, it } from "vitest";
import { analyzeFit, generateCoverLetter, safeSubmit } from "../src/services.js";
import { openDatabase } from "../src/db.js";

describe("resume assistant services", () => {
  it("returns an explainable, bounded fit score", () => {
    const result = analyzeFit("TypeScript React AWS engineer", { skills: ["TypeScript", "React"] }, []);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.rationale).toContain("Matched");
  });
  it("does not report generic prose as missing skills", () => {
    const result = analyzeFit("You would enjoy diving into data sets and working with teams", { skills: [] }, []);
    expect(result.missing).not.toContain("you");
    expect(result.missing).not.toContain("would");
    expect(result.missing).not.toContain("enjoy");
    expect(result.missing).not.toContain("data");
  });
  it("generates a cover letter from profile and job data", () => {
    expect(generateCoverLetter({ title: "Engineer", company: "Acme" }, { full_name: "Sam", skills: ["React"] })).toContain("Sam");
  });
  it("blocks mock submission until explicit approval", () => {
    const db = openDatabase(":memory:");
    const now = new Date().toISOString();
    const job = db.prepare("INSERT INTO jobs (title,description,created_at,updated_at) VALUES ('Role','A sufficiently long description for the role',?,?)").run(now, now);
    const app = db.prepare("INSERT INTO applications (job_id,created_at,updated_at) VALUES (?,?,?)").run(job.lastInsertRowid, now, now);
    expect(() => safeSubmit(db, Number(app.lastInsertRowid))).toThrow("Explicit approval");
    db.prepare("UPDATE applications SET approval_at=? WHERE id=?").run(now, app.lastInsertRowid);
    expect((safeSubmit(db, Number(app.lastInsertRowid)) as any).status).toBe("submitted");
  });
});
