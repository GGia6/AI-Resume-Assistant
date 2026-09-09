# AI Resume Assistant

Production-oriented local MVP for turning a resume and job postings into an organized, explainable application workflow. It never submits to a real employer: the only submission path is an explicit approval action followed by a visible safe mock adapter.

## Setup

Requirements: Node.js 20+.

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000. For a production build use `npm run build && npm start`.

## Configuration

`PORT` controls the HTTP port (default `3000`), `DATABASE_PATH` controls the SQLite file (default `./data/resume-assistant.db`), `UPLOAD_DIR` controls temporary upload storage (default `./uploads`), and `MAX_UPLOAD_MB` limits PDF uploads (default `5`).

## Architecture

- `src/server.ts`: Express API, validation, secure PDF upload handling, and static UI hosting.
- `src/db.ts`: SQLite schema/migrations and scoring criteria defaults.
- `src/services.ts`: profile persistence, explainable fit scoring, cover-letter generation, and the approval-gated mock submission adapter.
- `public/`: browser UI for import/editing, job analysis, application creation, approval, and history.
- `tests/`: targeted service tests.

The SQLite schema stores structured profiles, extracted source text metadata, jobs and fit rationales, applications, responses, and editable scoring criteria. PDF files are accepted only with the PDF MIME type, size-limited, processed locally, and removed after extraction.

## API highlights

`POST /api/profile/import` imports a PDF; `GET/PUT /api/profile` edits the structured profile; `POST /api/jobs` analyzes and stores a job; `GET /api/criteria` and `PUT /api/criteria/:id` configure scoring; `POST /api/applications` generates reusable application data and a cover letter; `POST /api/applications/:id/approve` records human approval; `POST /api/applications/:id/submit` invokes only `mock-safe-adapter`; `POST /api/applications/:id/responses` records recruiter responses; and `GET /api/history` returns the audit history.

## Limitations

Extraction is text-based and intentionally conservative; scanned/image-only PDFs need OCR added later. Fit scoring is a transparent keyword baseline, not a hiring recommendation. Cover letters are deterministic templates rather than a hosted LLM integration. No credentials, browser automation, external application submission, or hidden autonomous path is included.