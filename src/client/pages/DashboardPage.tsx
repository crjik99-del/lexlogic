// src/client/pages/DashboardPage.tsx
import { useState, useEffect } from "react";
import type { Expert } from "../App";

interface Doc {
  id: string; filename: string; tingkat_pengadilan: string; tahun: string;
  jenis_perkara: string; amar_putusan: string; text_length: number;
  extraction_score: number; annotation_status: string | null;
  overall_rating: number | null; annotated_at: string | null; ai_summary: string | null;
}
interface Props {
  expert: Expert;
  onNavigate: (p: any) => void;
  onLogout: () => void;
}

export function DashboardPage({ expert, onNavigate, onLogout }: Props) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, in_progress: 0, remaining: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "completed" | "in_progress">("all");
  const [search, setSearch] = useState("");
  const [summaryLoading, setSummaryLoading] = useState<Record<string, boolean>>({});
  const [summaryErr, setSummaryErr] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/documents")
      .then(r => r.json())
      .then(data => { setDocs(data.docs || []); setStats(data.stats || {}); })
      .finally(() => setLoading(false));
  }, []);

  const filtered = docs.filter(d => {
    const matchFilter =
      filter === "all" ? true :
      filter === "pending" ? !d.annotation_status :
      filter === "in_progress" ? d.annotation_status === "in_progress" :
      d.annotation_status === "completed";
    const matchSearch = !search || d.filename.toLowerCase().includes(search.toLowerCase()) ||
      d.tingkat_pengadilan?.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  const generateSummary = async (docId: string) => {
    setSummaryLoading(s => ({ ...s, [docId]: true }));
    setSummaryErr(s => ({ ...s, [docId]: "" }));
    try {
      const res = await fetch("/api/ai/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: docId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal membuat ringkasan");
      setDocs(prev => prev.map(d => d.id === docId ? { ...d, ai_summary: data.summary || "" } : d));
    } catch (err: any) {
      setSummaryErr(s => ({ ...s, [docId]: err.message || "Gagal membuat ringkasan" }));
    } finally {
      setSummaryLoading(s => ({ ...s, [docId]: false }));
    }
  };

  return (
    <div style={s.root}>
      {/* Header */}
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logo}>⚖ Platform Anotasi HAM</div>
          <div style={s.headerRight}>
            <div style={s.expertBadge}>
              <span style={{ opacity: 0.6, fontSize: "0.8rem" }}>Pakar:</span>
              <span style={{ fontWeight: 600 }}>{expert.name}</span>
              {expert.institution && <span style={{ opacity: 0.5, fontSize: "0.8rem" }}>· {expert.institution}</span>}
            </div>
            <button onClick={onLogout} style={s.logoutBtn}>Keluar</button>
          </div>
        </div>
      </header>

      <main style={s.main}>
        {/* Welcome & progress */}
        <section style={s.welcome}>
          <div>
            <h1 style={s.welcomeTitle}>Selamat datang, {expert.name.split(" ")[0]}</h1>
            <p style={s.welcomeSub}>
              Anda diminta untuk menilai kepatuhan HAM dalam {stats.total} putusan pengadilan Indonesia.
              Setiap anotasi membantu membangun sistem AI yang lebih baik untuk mendukung hakim.
            </p>
          </div>
          <div style={s.progressCard}>
            <div style={s.progressNumbers}>
              <StatBox n={stats.completed} label="Selesai" color="var(--green)" />
              <StatBox n={stats.in_progress} label="Sedang dikerjakan" color="var(--gold)" />
              <StatBox n={stats.remaining} label="Belum dimulai" color="var(--muted)" />
            </div>
            <div style={s.progressBarWrap}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Progress keseluruhan</span>
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--green)" }}>{pct}%</span>
              </div>
              <div style={s.progressBar}>
                <div style={{ ...s.progressFill, width: `${pct}%` }} />
              </div>
            </div>
          </div>
        </section>

        {/* Filter & search */}
        <div style={s.toolbar}>
          <div style={s.filterGroup}>
            {(["all","pending","in_progress","completed"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ ...s.filterBtn, ...(filter === f ? s.filterActive : {}) }}>
                {f === "all" ? "Semua" : f === "pending" ? "Belum Dimulai" :
                 f === "in_progress" ? "Sedang Dikerjakan" : "Selesai"}
                <span style={s.filterCount}>
                  {f === "all" ? stats.total : f === "pending" ? stats.remaining :
                   f === "in_progress" ? stats.in_progress : stats.completed}
                </span>
              </button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari putusan..."
            style={s.search} />
        </div>

        {/* Guidelines banner */}
        <div style={s.guide}>
          <strong>📋 Panduan Singkat:</strong> Baca seluruh putusan → identifikasi apakah hakim mempertimbangkan
          prinsip HAM yang relevan → berikan penilaian 1-5 bintang → tandai parameter HAM yang ditemukan →
          tambahkan catatan untuk pakar lain.
        </div>

        {/* Document grid */}
        {loading ? (
          <div style={s.loadingMsg}>Memuat dokumen...</div>
        ) : (
          <div style={s.grid}>
            {filtered.map(doc => (
              <DocCard
                key={doc.id}
                doc={doc}
                onOpen={() => onNavigate({ name: "annotate", docId: doc.id })}
                onSummary={() => generateSummary(doc.id)}
                summaryLoading={!!summaryLoading[doc.id]}
                summaryError={summaryErr[doc.id]}
              />
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
                Tidak ada dokumen ditemukan.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function StatBox({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontFamily: "var(--display)", fontSize: "1.8rem", fontWeight: 700, color }}>{n}</div>
      <div style={{ fontSize: "0.72rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}

function DocCard({
  doc, onOpen, onSummary, summaryLoading, summaryError
}: {
  doc: Doc; onOpen: () => void; onSummary: () => void; summaryLoading: boolean; summaryError?: string;
}) {
  const status = doc.annotation_status;
  const statusColor = status === "completed" ? "var(--green)" : status === "in_progress" ? "var(--gold)" : "var(--muted)";
  const statusLabel = status === "completed" ? "✓ Selesai" : status === "in_progress" ? "⋯ Dikerjakan" : "○ Belum dimulai";

  return (
    <div style={s.card} onClick={onOpen}>
      <div style={s.cardTop}>
        <span style={{ ...s.courtBadge, background: courtColor(doc.tingkat_pengadilan) }}>
          {shortCourt(doc.tingkat_pengadilan)}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{doc.tahun}</span>
      </div>

      <h3 style={s.cardTitle}>{doc.filename.replace(".pdf", "").slice(0, 60)}</h3>

      <div style={s.cardMeta}>
        <span style={s.metaTag}>{doc.jenis_perkara || "Pidana"}</span>
        <span style={{ ...s.metaTag, background: doc.amar_putusan === "pidana" ? "#fef2f2" : "#f0fdf4",
          color: doc.amar_putusan === "pidana" ? "var(--red)" : "var(--green)" }}>
          {doc.amar_putusan || "?"}
        </span>
      </div>

      {doc.ai_summary ? (
        <div style={s.summaryBox}>{doc.ai_summary}</div>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSummary(); }}
          disabled={summaryLoading}
          style={s.aiBtn}
        >
          {summaryLoading ? "Membuat ringkasan..." : "Ringkas dengan Gemini"}
        </button>
      )}
      {!!summaryError && <div style={s.summaryError}>{summaryError}</div>}

      <div style={s.cardFooter}>
        <span style={{ fontSize: "0.75rem", color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
        {doc.overall_rating && (
          <span style={{ fontSize: "0.75rem", color: "var(--gold)" }}>
            {"★".repeat(doc.overall_rating)}{"☆".repeat(5 - doc.overall_rating)}
          </span>
        )}
        <span style={s.openBtn}>Buka →</span>
      </div>
    </div>
  );
}

function shortCourt(level: string) {
  const map: Record<string,string> = {
    "Mahkamah Agung": "MA", "Pengadilan Tinggi": "PT",
    "Pengadilan Negeri": "PN", "Pengadilan Agama": "PA",
    "Pengadilan Militer": "Mil", "Pengadilan Militer Tinggi": "MilTi",
    "Pengadilan Tinggi Agama": "PTA"
  };
  return map[level] || level?.slice(0,2) || "?";
}

function courtColor(level: string) {
  const map: Record<string,string> = {
    "Mahkamah Agung": "#1e3a5f", "Pengadilan Tinggi": "#2c5f3c",
    "Pengadilan Negeri": "#5f3a1e", "Pengadilan Agama": "#3a1e5f",
    "Pengadilan Militer": "#5f1e2c",
  };
  return map[level] || "#4a4a4a";
}

const s: Record<string, React.CSSProperties> = {
  root: { minHeight: "100vh", background: "var(--paper)" },
  header: { background: "var(--ink)", borderBottom: "2px solid var(--gold)", position: "sticky", top: 0, zIndex: 100 },
  headerInner: { maxWidth: 1200, margin: "0 auto", padding: "0 2rem", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" },
  logo: { fontFamily: "var(--display)", color: "var(--gold-l)", fontSize: "1.1rem", fontWeight: 600, letterSpacing: "0.03em" },
  headerRight: { display: "flex", alignItems: "center", gap: "1.5rem" },
  expertBadge: { display: "flex", gap: "0.5rem", alignItems: "center", color: "var(--paper)", fontSize: "0.875rem" },
  logoutBtn: { background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", padding: "0.35rem 0.85rem", borderRadius: 3, cursor: "pointer", fontSize: "0.8rem" },
  main: { maxWidth: 1200, margin: "0 auto", padding: "2rem" },
  welcome: { display: "grid", gridTemplateColumns: "1fr auto", gap: "2rem", alignItems: "start", marginBottom: "2rem", background: "white", border: "1px solid var(--border)", borderRadius: 4, padding: "2rem", boxShadow: "0 2px 8px var(--shadow)" },
  welcomeTitle: { fontFamily: "var(--display)", fontSize: "1.6rem", fontWeight: 700, marginBottom: "0.75rem" },
  welcomeSub: { color: "var(--muted)", lineHeight: 1.6, maxWidth: 500, fontSize: "0.9rem" },
  progressCard: { minWidth: 280 },
  progressNumbers: { display: "flex", gap: "1.5rem", marginBottom: "1.5rem", justifyContent: "center" },
  progressBarWrap: { padding: "0 0.5rem" },
  progressBar: { height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", background: "var(--green)", borderRadius: 4, transition: "width 0.8s ease" },
  toolbar: { display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center", flexWrap: "wrap" },
  filterGroup: { display: "flex", gap: "0.5rem", flexWrap: "wrap" },
  filterBtn: { background: "white", border: "1px solid var(--border)", borderRadius: 20, padding: "0.35rem 0.85rem", fontSize: "0.8rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem", transition: "all 0.15s" },
  filterActive: { background: "var(--ink)", color: "var(--gold-l)", borderColor: "var(--ink)" },
  filterCount: { background: "var(--border)", borderRadius: 10, padding: "0.1rem 0.4rem", fontSize: "0.7rem" },
  search: { marginLeft: "auto", padding: "0.4rem 0.85rem", border: "1px solid var(--border)", borderRadius: 20, background: "white", fontSize: "0.85rem", outline: "none", width: 220 },
  guide: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, padding: "1rem 1.25rem", fontSize: "0.85rem", color: "#92400e", lineHeight: 1.6, marginBottom: "1.5rem" },
  loadingMsg: { textAlign: "center", padding: "3rem", color: "var(--muted)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" },
  card: { background: "white", border: "1px solid var(--border)", borderRadius: 4, padding: "1.25rem", cursor: "pointer", transition: "all 0.2s", boxShadow: "0 1px 4px var(--shadow)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" },
  courtBadge: { color: "white", fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.6rem", borderRadius: 3, letterSpacing: "0.05em" },
  cardTitle: { fontFamily: "var(--serif)", fontSize: "0.875rem", fontWeight: 600, lineHeight: 1.4, marginBottom: "0.75rem", color: "var(--ink)" },
  cardMeta: { display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" },
  metaTag: { fontSize: "0.7rem", background: "var(--cream)", border: "1px solid var(--border)", borderRadius: 3, padding: "0.15rem 0.5rem", color: "var(--muted)" },
  aiBtn: { width: "100%", border: "1px solid var(--gold)", color: "var(--gold)", background: "#fffdf6", borderRadius: 3, padding: "0.45rem 0.7rem", fontSize: "0.78rem", cursor: "pointer", marginBottom: "0.75rem" },
  summaryBox: { fontSize: "0.76rem", color: "#3f3a2f", lineHeight: 1.5, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 3, padding: "0.55rem 0.6rem", marginBottom: "0.75rem", whiteSpace: "pre-wrap" },
  summaryError: { fontSize: "0.72rem", color: "var(--red)", marginBottom: "0.5rem" },
  cardFooter: { display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" },
  openBtn: { fontSize: "0.75rem", color: "var(--gold)", fontWeight: 600 },
};
