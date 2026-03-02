// src/worker.ts
// Cloudflare Workers entry point
// Handles: HTTP requests (Hono) + Cron trigger (daily D1 → GitHub backup)

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { randomBytes } from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_KEY: string;
  GITHUB_TOKEN: string;       // Secret: wrangler secret put GITHUB_TOKEN
  GEMINI_API_KEY: string;     // Secret: wrangler secret put GEMINI_API_KEY
  GITHUB_REPO: string;        // e.g. "username/ham-annotation-app"
  GITHUB_BACKUP_BRANCH: string; // e.g. "data-backup"
  GEMINI_MODEL?: string;      // e.g. "gemini-2.0-flash"
}

// ── Hono App ──────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", credentials: true }));

// ── Auth helpers ──────────────────────────────────────────────────────────────

function genToken(): string {
  return randomBytes(32).toString("hex");
}

function genInviteCode(name: string): string {
  const initials = name.split(" ").map((w: string) => w[0] || "").join("").toUpperCase().slice(0, 3);
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${initials}-${rand}`;
}

async function getExpertFromCookie(c: any, env: Env) {
  const token = getCookie(c, "session") || c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const row = await env.DB.prepare(`
    SELECT e.* FROM sessions s
    JOIN experts e ON s.expert_id = e.id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND e.is_active = 1
  `).bind(token).first();
  return row || null;
}

function requireAdmin(c: any, env: Env): boolean {
  const key = c.req.query("admin_key") || c.req.header("X-Admin-Key");
  return key === env.ADMIN_KEY;
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function extractGeminiText(payload: any): string {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p: any) => p?.text || "").join("").trim();
}

async function callGemini(env: Env, prompt: string, asJson = false): Promise<any> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY belum diset");
  }
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: asJson ? 0.1 : 0.3,
        ...(asJson ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const text = extractGeminiText(data);
  if (!text) throw new Error("Gemini tidak mengembalikan konten");
  if (!asJson) return text;
  return safeJsonParse<any>(text, {});
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.post("/api/auth/login", async (c) => {
  const { inviteCode } = await c.req.json<{ inviteCode: string }>();
  const expert = await c.env.DB.prepare(
    "SELECT * FROM experts WHERE invite_code = ? AND is_active = 1"
  ).bind(inviteCode?.trim().toUpperCase()).first() as any;

  if (!expert) return c.json({ error: "Kode undangan tidak valid" }, 401);

  const token = genToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await c.env.DB.prepare(
    "INSERT INTO sessions (token, expert_id, expires_at) VALUES (?, ?, ?)"
  ).bind(token, expert.id, expiresAt).run();

  await c.env.DB.prepare(
    "INSERT INTO audit_log (expert_id, action) VALUES (?, ?)"
  ).bind(expert.id, "login").run();

  setCookie(c, "session", token, {
    httpOnly: true, sameSite: "Lax", maxAge: 30 * 24 * 3600,
    secure: true, path: "/"
  });

  return c.json({ ok: true, expert: { id: expert.id, name: expert.name, email: expert.email } });
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, "session");
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/auth/me", async (c) => {
  const expert = await getExpertFromCookie(c, c.env);
  if (!expert) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ expert });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOCUMENTS
// ══════════════════════════════════════════════════════════════════════════════

app.get("/api/documents", async (c) => {
  const expert = await getExpertFromCookie(c, c.env) as any;
  if (!expert) return c.json({ error: "Unauthorized" }, 401);

  const { results: docs } = await c.env.DB.prepare(`
    SELECT d.id, d.tingkat_pengadilan, d.tahun, d.jenis_perkara,
           d.amar_putusan, d.text_length, d.extraction_score,
           d.metadata_json,
           a.status AS annotation_status, a.overall_rating,
           a.updated_at AS annotated_at
    FROM documents d
    LEFT JOIN annotations a ON a.document_id = d.id AND a.expert_id = ?
    ORDER BY d.tahun DESC, d.id
  `).bind(expert.id).all();

  const normalizedDocs = (docs as any[]).map((d: any) => {
    const meta = safeJsonParse<any>(d.metadata_json, {});
    return {
      ...d,
      ai_summary: typeof meta.ai_summary === "string" ? meta.ai_summary : null,
    };
  });

  const total = normalizedDocs.length;
  const completed = normalizedDocs.filter((d: any) => d.annotation_status === "completed").length;
  const in_progress = normalizedDocs.filter((d: any) => d.annotation_status === "in_progress").length;

  return c.json({ docs: normalizedDocs, stats: { total, completed, in_progress, remaining: total - completed - in_progress } });
});

app.get("/api/documents/:id", async (c) => {
  const expert = await getExpertFromCookie(c, c.env) as any;
  if (!expert) return c.json({ error: "Unauthorized" }, 401);

  const docId = c.req.param("id");
  const doc = await c.env.DB.prepare("SELECT * FROM documents WHERE id = ?").bind(docId).first();
  if (!doc) return c.json({ error: "Not found" }, 404);

  const annotation = await c.env.DB.prepare(
    "SELECT * FROM annotations WHERE document_id = ? AND expert_id = ?"
  ).bind(docId, expert.id).first();

  await c.env.DB.prepare(
    "INSERT INTO audit_log (expert_id, action, document_id) VALUES (?, ?, ?)"
  ).bind(expert.id, "view_document", docId).run();

  return c.json({ doc, annotation: annotation || null });
});

// ══════════════════════════════════════════════════════════════════════════════
// HAM PARAMETERS
// ══════════════════════════════════════════════════════════════════════════════

app.get("/api/ham-parameters", async (c) => {
  const expert = await getExpertFromCookie(c, c.env);
  if (!expert) return c.json({ error: "Unauthorized" }, 401);
  const { results } = await c.env.DB.prepare("SELECT * FROM ham_parameters ORDER BY id").all();
  return c.json({ params: results });
});

// ══════════════════════════════════════════════════════════════════════════════
// AI ASSIST (GEMINI)
// ══════════════════════════════════════════════════════════════════════════════

app.post("/api/ai/auto-tag", async (c) => {
  const expert = await getExpertFromCookie(c, c.env);
  if (!expert) return c.json({ error: "Unauthorized" }, 401);

  const { document_id } = await c.req.json<{ document_id: string }>();
  if (!document_id) return c.json({ error: "document_id required" }, 400);

  const doc = await c.env.DB.prepare(
    "SELECT id, isi_putusan FROM documents WHERE id = ?"
  ).bind(document_id).first<any>();
  if (!doc) return c.json({ error: "Document not found" }, 404);

  const { results: params } = await c.env.DB.prepare(
    "SELECT id, kategori, sub_kategori, kaidah_hukum FROM ham_parameters ORDER BY id"
  ).all<any>();

  const compactParams = (params || []).map((p: any) => ({
    id: p.id,
    kategori: p.kategori,
    sub_kategori: p.sub_kategori,
    kaidah_hukum: String(p.kaidah_hukum || "").slice(0, 200),
  }));

  const prompt = [
    "Anda adalah asisten anotasi HAM untuk putusan pengadilan Indonesia.",
    "Tugas: dari teks putusan dan daftar parameter HAM, pilih parameter yang relevan.",
    "Jawaban WAJIB JSON valid dengan schema:",
    "{\"ham_parameters_found\": string[], \"fair_trial_addressed\": boolean, \"non_discrimination_addressed\": boolean, \"freedom_expression_addressed\": boolean, \"due_process_addressed\": boolean, \"overall_notes_draft\": string}",
    "Aturan:",
    "- Gunakan HANYA id yang ada pada daftar parameter.",
    "- overall_notes_draft maksimal 120 kata, bahasa Indonesia formal.",
    "- Jangan tambahkan field lain.",
    "",
    `Daftar parameter: ${JSON.stringify(compactParams)}`,
    "",
    `Teks putusan (potongan): ${String(doc.isi_putusan || "").slice(0, 14000)}`,
  ].join("\n");

  try {
    const raw = await callGemini(c.env, prompt, true);
    const allowedIds = new Set((params || []).map((p: any) => p.id));
    const ids = Array.isArray(raw?.ham_parameters_found)
      ? raw.ham_parameters_found.filter((id: any) => typeof id === "string" && allowedIds.has(id))
      : [];

    return c.json({
      ok: true,
      ham_parameters_found: ids,
      fair_trial_addressed: !!raw?.fair_trial_addressed,
      non_discrimination_addressed: !!raw?.non_discrimination_addressed,
      freedom_expression_addressed: !!raw?.freedom_expression_addressed,
      due_process_addressed: !!raw?.due_process_addressed,
      overall_notes_draft: typeof raw?.overall_notes_draft === "string" ? raw.overall_notes_draft : "",
    });
  } catch (err: any) {
    return c.json({ ok: false, error: `Auto-tag gagal: ${err.message}` }, 502);
  }
});

app.post("/api/ai/summary", async (c) => {
  const expert = await getExpertFromCookie(c, c.env);
  if (!expert) return c.json({ error: "Unauthorized" }, 401);

  const { document_id } = await c.req.json<{ document_id: string }>();
  if (!document_id) return c.json({ error: "document_id required" }, 400);

  const doc = await c.env.DB.prepare(
    "SELECT id, isi_putusan, metadata_json FROM documents WHERE id = ?"
  ).bind(document_id).first<any>();
  if (!doc) return c.json({ error: "Document not found" }, 404);

  const meta = safeJsonParse<any>(doc.metadata_json, {});
  if (typeof meta.ai_summary === "string" && meta.ai_summary.trim()) {
    return c.json({ ok: true, summary: meta.ai_summary, cached: true });
  }

  const prompt = [
    "Ringkas putusan pengadilan berikut dalam bahasa Indonesia.",
    "Format WAJIB:",
    "1) Ringkasan inti 2-3 kalimat.",
    "2) Tiga poin HAM yang paling relevan (bullet).",
    "Batas total 140 kata. Hindari spekulasi.",
    "",
    `Teks putusan (potongan): ${String(doc.isi_putusan || "").slice(0, 14000)}`,
  ].join("\n");

  try {
    const summary = String(await callGemini(c.env, prompt, false)).trim();
    const nextMeta = { ...meta, ai_summary: summary, ai_summary_generated_at: new Date().toISOString() };
    await c.env.DB.prepare("UPDATE documents SET metadata_json = ? WHERE id = ?")
      .bind(JSON.stringify(nextMeta), document_id)
      .run();
    return c.json({ ok: true, summary, cached: false });
  } catch (err: any) {
    return c.json({ ok: false, error: `Summary gagal: ${err.message}` }, 502);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ANNOTATIONS
// ══════════════════════════════════════════════════════════════════════════════

app.post("/api/annotations", async (c) => {
  const expert = await getExpertFromCookie(c, c.env) as any;
  if (!expert) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<any>();
  const {
    document_id, overall_rating, overall_notes,
    ham_parameters_found, ham_compliance_score, missing_considerations,
    fair_trial_addressed, non_discrimination_addressed,
    freedom_expression_addressed, due_process_addressed,
    recommendation, suggested_citations, status, time_spent_minutes
  } = body;

  if (!document_id) return c.json({ error: "document_id required" }, 400);

  const doc = await c.env.DB.prepare("SELECT id FROM documents WHERE id = ?").bind(document_id).first();
  if (!doc) return c.json({ error: "Document not found" }, 404);

  const existing = await c.env.DB.prepare(
    "SELECT id FROM annotations WHERE document_id = ? AND expert_id = ?"
  ).bind(document_id, expert.id).first() as any;

  const id = existing?.id || crypto.randomUUID();

  await c.env.DB.prepare(`
    INSERT INTO annotations (
      id, document_id, expert_id, overall_rating, overall_notes,
      ham_parameters_found, ham_compliance_score, missing_considerations,
      fair_trial_addressed, non_discrimination_addressed,
      freedom_expression_addressed, due_process_addressed,
      recommendation, suggested_citations, status, time_spent_minutes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(document_id, expert_id) DO UPDATE SET
      overall_rating = excluded.overall_rating,
      overall_notes = excluded.overall_notes,
      ham_parameters_found = excluded.ham_parameters_found,
      ham_compliance_score = excluded.ham_compliance_score,
      missing_considerations = excluded.missing_considerations,
      fair_trial_addressed = excluded.fair_trial_addressed,
      non_discrimination_addressed = excluded.non_discrimination_addressed,
      freedom_expression_addressed = excluded.freedom_expression_addressed,
      due_process_addressed = excluded.due_process_addressed,
      recommendation = excluded.recommendation,
      suggested_citations = excluded.suggested_citations,
      status = excluded.status,
      time_spent_minutes = excluded.time_spent_minutes,
      updated_at = datetime('now')
  `).bind(
    id, document_id, expert.id,
    overall_rating || null, overall_notes || "",
    JSON.stringify(ham_parameters_found || []),
    ham_compliance_score ?? 50, missing_considerations || "",
    fair_trial_addressed ? 1 : 0, non_discrimination_addressed ? 1 : 0,
    freedom_expression_addressed ? 1 : 0, due_process_addressed ? 1 : 0,
    recommendation || null, suggested_citations || "",
    status || "in_progress", time_spent_minutes || 0
  ).run();

  await c.env.DB.prepare(
    "INSERT INTO audit_log (expert_id, action, document_id, detail) VALUES (?, ?, ?, ?)"
  ).bind(expert.id, status === "completed" ? "complete_annotation" : "save_annotation",
    document_id, JSON.stringify({ status, overall_rating })).run();

  return c.json({ ok: true, id });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/stats
app.get("/api/admin/stats", async (c) => {
  if (!requireAdmin(c, c.env)) return c.json({ error: "Forbidden" }, 403);

  const [totalDocs, totalExperts, totalAnn, completedAnn, experts, activity] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as n FROM documents").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM experts WHERE is_active=1").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM annotations").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM annotations WHERE status='completed'").first<{ n: number }>(),
    c.env.DB.prepare(`
      SELECT e.id, e.name, e.email, e.institution, e.invite_code, e.created_at,
        COUNT(a.id) as annotations_done,
        SUM(CASE WHEN a.status='completed' THEN 1 ELSE 0 END) as completed
      FROM experts e LEFT JOIN annotations a ON a.expert_id = e.id
      WHERE e.is_active=1 GROUP BY e.id ORDER BY e.created_at DESC
    `).all(),
    c.env.DB.prepare(`
      SELECT al.*, e.name as expert_name FROM audit_log al
      LEFT JOIN experts e ON al.expert_id = e.id
      ORDER BY al.created_at DESC LIMIT 30
    `).all(),
  ]);

  return c.json({
    total_documents: totalDocs?.n ?? 0,
    total_experts: totalExperts?.n ?? 0,
    total_annotations: totalAnn?.n ?? 0,
    completed_annotations: completedAnn?.n ?? 0,
    experts: experts.results,
    recent_activity: activity.results,
  });
});

// POST /api/admin/experts — buat akun pakar baru
app.post("/api/admin/experts", async (c) => {
  if (!requireAdmin(c, c.env)) return c.json({ error: "Forbidden" }, 403);
  const { name, email, institution, expertise } = await c.req.json<any>();
  if (!name || !email) return c.json({ error: "name and email required" }, 400);

  const id = crypto.randomUUID();
  const inviteCode = genInviteCode(name);

  await c.env.DB.prepare(`
    INSERT INTO experts (id, name, email, institution, expertise, invite_code)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, name, email, institution || "", expertise || "", inviteCode).run();

  return c.json({ ok: true, id, invite_code: inviteCode });
});

// POST /api/admin/load-documents — upload corpus JSON langsung ke D1
// Gunakan ini untuk load data dari PC lokal ke D1
app.post("/api/admin/load-documents", async (c) => {
  if (!requireAdmin(c, c.env)) return c.json({ error: "Forbidden" }, 403);

  const { documents } = await c.req.json<{ documents: any[] }>();
  if (!documents?.length) return c.json({ error: "documents array required" }, 400);

  let inserted = 0;
  // D1 batch insert (max 100 per batch)
  const batchSize = 50;
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    const stmts = batch.map(doc =>
      c.env.DB.prepare(`
        INSERT OR REPLACE INTO documents
        (id, tingkat_pengadilan, tahun, jenis_perkara, amar_putusan,
         text_length, extraction_score, isi_putusan, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        doc.id,
        doc.tingkat_pengadilan || null,
        doc.tahun || null,
        doc.jenis_perkara || null,
        doc.amar_putusan || null,
        doc.text_length || doc.isi_putusan?.length || 0,
        doc.extraction_score || null,
        doc.isi_putusan || "",
        JSON.stringify({ nomor_perkara: doc.nomor_perkara, pengadilan: doc.pengadilan, tanggal_putusan: doc.tanggal_putusan })
      )
    );
    await c.env.DB.batch(stmts);
    inserted += batch.length;
  }

  return c.json({ ok: true, inserted });
});

// GET /api/admin/export — export semua anotasi sebagai JSON
app.get("/api/admin/export", async (c) => {
  if (!requireAdmin(c, c.env)) return c.json({ error: "Forbidden" }, 403);

  const { results } = await c.env.DB.prepare(`
    SELECT a.*, e.name as expert_name, e.institution,
           d.id as doc_id, d.tingkat_pengadilan, d.tahun, d.jenis_perkara, d.amar_putusan
    FROM annotations a
    JOIN experts e ON a.expert_id = e.id
    JOIN documents d ON a.document_id = d.id
    ORDER BY a.updated_at DESC
  `).all();

  const format = c.req.query("format");
  if (format === "csv") {
    if (!results.length) return c.text("No data");
    const headers = Object.keys(results[0] as any).join(",");
    const rows = (results as any[]).map(r =>
      Object.values(r).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
    );
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename=annotations-${new Date().toISOString().slice(0,10)}.csv`);
    return c.text([headers, ...rows].join("\n"));
  }

  return c.json({ exported_at: new Date().toISOString(), count: results.length, annotations: results });
});

// POST /api/admin/backup-now — trigger backup manual ke GitHub
app.post("/api/admin/backup-now", async (c) => {
  if (!requireAdmin(c, c.env)) return c.json({ error: "Forbidden" }, 403);
  const result = await runGitHubBackup(c.env);
  return c.json(result);
});

// ══════════════════════════════════════════════════════════════════════════════
// GITHUB BACKUP FUNCTION
// ══════════════════════════════════════════════════════════════════════════════

async function runGitHubBackup(env: Env): Promise<{ ok: boolean; message: string; sha?: string }> {
  try {
    // Fetch all annotations
    const { results: annotations } = await env.DB.prepare(`
      SELECT a.*, e.name as expert_name, e.institution,
             d.id as doc_id, d.tingkat_pengadilan, d.tahun, d.jenis_perkara, d.amar_putusan
      FROM annotations a
      JOIN experts e ON a.expert_id = e.id
      JOIN documents d ON a.document_id = d.id
      ORDER BY a.updated_at DESC
    `).all();

    const stats = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM documents) as total_documents,
        (SELECT COUNT(*) FROM experts WHERE is_active=1) as total_experts,
        (SELECT COUNT(*) FROM annotations) as total_annotations,
        (SELECT COUNT(*) FROM annotations WHERE status='completed') as completed_annotations
    `).first();

    const exportData = {
      exported_at: new Date().toISOString(),
      stats,
      count: annotations.length,
      annotations,
    };

    const dateStr = new Date().toISOString().slice(0, 10);
    const filePath = `data/annotations-${dateStr}.json`;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(exportData, null, 2))));

    // Check if file exists (to get SHA for update)
    const headers = {
      "Authorization": `token ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "ham-annotation-worker",
    };

    const checkRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${filePath}?ref=${env.GITHUB_BACKUP_BRANCH}`,
      { headers }
    );
    const checkData = checkRes.ok ? await checkRes.json() as any : null;

    // Create or update file
    const body: any = {
      message: `backup: annotations ${dateStr} (${annotations.length} records)`,
      content,
      branch: env.GITHUB_BACKUP_BRANCH,
    };
    if (checkData?.sha) body.sha = checkData.sha;

    const putRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${filePath}`,
      { method: "PUT", headers, body: JSON.stringify(body) }
    );

    if (!putRes.ok) {
      const err = await putRes.text();
      return { ok: false, message: `GitHub API error: ${err}` };
    }

    const putData = await putRes.json() as any;

    // Also update latest.json (always overwrite, always same sha lookup)
    const latestPath = "data/annotations-latest.json";
    const latestCheck = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${latestPath}?ref=${env.GITHUB_BACKUP_BRANCH}`,
      { headers }
    ).then(r => r.ok ? r.json() : null).catch(() => null) as any;

    const latestBody: any = {
      message: `backup: update latest (${dateStr})`,
      content,
      branch: env.GITHUB_BACKUP_BRANCH,
    };
    if (latestCheck?.sha) latestBody.sha = latestCheck.sha;

    await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${latestPath}`,
      { method: "PUT", headers, body: JSON.stringify(latestBody) }
    ).catch(() => {});

    // Log backup
    await env.DB.prepare(
      "INSERT INTO audit_log (action, detail) VALUES (?, ?)"
    ).bind("github_backup", JSON.stringify({ file: filePath, records: annotations.length })).run();

    return {
      ok: true,
      message: `Backup berhasil: ${annotations.length} anotasi → GitHub ${filePath}`,
      sha: putData.content?.sha,
    };

  } catch (err: any) {
    return { ok: false, message: `Backup error: ${err.message}` };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// STATIC ASSETS — fallback to index.html for SPA routing
// ══════════════════════════════════════════════════════════════════════════════

app.get("*", async (c) => {
  // Let Cloudflare Assets handle static files first
  const url = new URL(c.req.url);
  if (url.pathname.startsWith("/dist/") || url.pathname.startsWith("/assets/")) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  // SPA fallback — serve index.html
  const indexReq = new Request(new URL("/index.html", c.req.url).toString(), c.req.raw);
  return c.env.ASSETS.fetch(indexReq);
});

// ══════════════════════════════════════════════════════════════════════════════
// WORKER EXPORT — handles both HTTP requests and Cron triggers
// ══════════════════════════════════════════════════════════════════════════════

export default {
  // HTTP requests
  fetch: app.fetch,

  // Cron trigger — "0 17 * * *" = 00:00 WIB setiap hari
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log(`[Cron] Backup triggered at ${new Date().toISOString()}`);
    const result = await runGitHubBackup(env);
    console.log(`[Cron] Backup result:`, result);
  },
};
