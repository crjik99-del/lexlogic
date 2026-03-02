// src/client/pages/AnnotatePage.tsx
import { useState, useEffect, useRef } from "react";
import type { Expert } from "../App";

interface Doc { id: string; filename: string; tingkat_pengadilan: string; tahun: string;
  jenis_perkara: string; amar_putusan: string; isi_putusan: string; text_length: number; }
interface HAMParam { id: string; kategori: string; sub_kategori: string;
  kaidah_hukum: string; prinsip_ham: string; kata_kunci: string; }
interface Annotation {
  overall_rating: number; overall_notes: string; ham_parameters_found: string[];
  ham_compliance_score: number; missing_considerations: string;
  fair_trial_addressed: boolean; non_discrimination_addressed: boolean;
  freedom_expression_addressed: boolean; due_process_addressed: boolean;
  recommendation: string; suggested_citations: string;
  status: "in_progress" | "completed"; time_spent_minutes: number;
}

const EMPTY: Annotation = {
  overall_rating: 0, overall_notes: "", ham_parameters_found: [],
  ham_compliance_score: 50, missing_considerations: "",
  fair_trial_addressed: false, non_discrimination_addressed: false,
  freedom_expression_addressed: false, due_process_addressed: false,
  recommendation: "", suggested_citations: "", status: "in_progress", time_spent_minutes: 0,
};

interface Props { docId: string; expert: Expert; onBack: () => void; onLogout: () => void; }

export function AnnotatePage({ docId, expert, onBack, onLogout }: Props) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [hamParams, setHamParams] = useState<HAMParam[]>([]);
  const [ann, setAnn] = useState<Annotation>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"text" | "form">("text");
  const [searchText, setSearchText] = useState("");
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const startTime = useRef(Date.now());

  useEffect(() => {
    Promise.all([
      fetch(`/api/documents/${encodeURIComponent(docId)}`).then(r => r.json()),
      fetch("/api/ham-parameters").then(r => r.json())
    ]).then(([docData, kbData]) => {
      setDoc(docData.doc);
      setHamParams(kbData.params || []);
      if (docData.annotation) {
        const a = docData.annotation;
        setAnn({
          overall_rating: a.overall_rating || 0,
          overall_notes: a.overall_notes || "",
          ham_parameters_found: JSON.parse(a.ham_parameters_found || "[]"),
          ham_compliance_score: a.ham_compliance_score || 50,
          missing_considerations: a.missing_considerations || "",
          fair_trial_addressed: !!a.fair_trial_addressed,
          non_discrimination_addressed: !!a.non_discrimination_addressed,
          freedom_expression_addressed: !!a.freedom_expression_addressed,
          due_process_addressed: !!a.due_process_addressed,
          recommendation: a.recommendation || "",
          suggested_citations: a.suggested_citations || "",
          status: a.status || "in_progress",
          time_spent_minutes: a.time_spent_minutes || 0,
        });
      }
    }).finally(() => setLoading(false));
  }, [docId]);

  const save = async (status: "in_progress" | "completed") => {
    setSaving(true);
    const elapsed = Math.round((Date.now() - startTime.current) / 60000);
    try {
      await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ann, document_id: docId, status,
          time_spent_minutes: (ann.time_spent_minutes || 0) + elapsed })
      });
      setAnn(a => ({ ...a, status, time_spent_minutes: (a.time_spent_minutes || 0) + elapsed }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      if (status === "completed") onBack();
    } finally { setSaving(false); }
  };

  const toggleHAM = (id: string) => {
    setAnn(a => ({
      ...a,
      ham_parameters_found: a.ham_parameters_found.includes(id)
        ? a.ham_parameters_found.filter(x => x !== id)
        : [...a.ham_parameters_found, id]
    }));
  };

  const runAutoTag = async () => {
    setAiSuggesting(true);
    setAiStatus("");
    try {
      const res = await fetch("/api/ai/auto-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: docId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Auto-tag gagal");

      const suggested = Array.isArray(data.ham_parameters_found) ? data.ham_parameters_found : [];
      setAnn(prev => ({
        ...prev,
        ham_parameters_found: Array.from(new Set([...prev.ham_parameters_found, ...suggested])),
        fair_trial_addressed: prev.fair_trial_addressed || !!data.fair_trial_addressed,
        non_discrimination_addressed: prev.non_discrimination_addressed || !!data.non_discrimination_addressed,
        freedom_expression_addressed: prev.freedom_expression_addressed || !!data.freedom_expression_addressed,
        due_process_addressed: prev.due_process_addressed || !!data.due_process_addressed,
        overall_notes: prev.overall_notes || (typeof data.overall_notes_draft === "string" ? data.overall_notes_draft : ""),
      }));

      setAiStatus(`Gemini menyarankan ${suggested.length} parameter HAM.`);
    } catch (err: any) {
      setAiStatus(err.message || "Auto-tag gagal");
    } finally {
      setAiSuggesting(false);
    }
  };

  const highlighted = (text: string) => {
    if (!searchText.trim()) return text;
    const re = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`, "gi");
    return text.replace(re, '<mark style="background:#fef08a;padding:0 2px;border-radius:2px">$1</mark>');
  };

  if (loading) return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontFamily:"var(--serif)",color:"var(--muted)" }}>Memuat dokumen...</div>;
  if (!doc) return <div style={{ padding:"2rem" }}>Dokumen tidak ditemukan.</div>;

  const categories = [...new Set(hamParams.map(p => p.kategori))];

  return (
    <div style={s.root}>
      {/* Top bar */}
      <header style={s.header}>
        <button onClick={onBack} style={s.backBtn}>← Kembali</button>
        <div style={s.headerCenter}>
          <span style={s.courtTag}>{doc.tingkat_pengadilan}</span>
          <span style={s.docTitle}>{doc.filename.replace(".pdf","").slice(0, 55)}</span>
        </div>
        <div style={s.headerRight}>
          {saved && <span style={s.savedBadge}>✓ Tersimpan</span>}
          <button onClick={() => save("in_progress")} disabled={saving} style={s.saveBtn}>
            {saving ? "..." : "Simpan Draft"}
          </button>
          <button onClick={onLogout} style={s.logoutBtn}>Keluar</button>
        </div>
      </header>

      {/* Mobile tabs */}
      <div style={s.tabs}>
        <button onClick={() => setActiveTab("text")} style={{ ...s.tab, ...(activeTab==="text" ? s.tabActive : {}) }}>📄 Teks Putusan</button>
        <button onClick={() => setActiveTab("form")} style={{ ...s.tab, ...(activeTab==="form" ? s.tabActive : {}) }}>
          ✏ Formulir Anotasi
          {ann.ham_parameters_found.length > 0 && <span style={s.tabBadge}>{ann.ham_parameters_found.length}</span>}
        </button>
      </div>

      <div style={s.body}>
        {/* Left: Document text */}
        <div style={{ ...s.panel, display: activeTab === "text" || window.innerWidth > 900 ? "flex" : "none" }}>
          <div style={s.panelHeader}>
            <h2 style={s.panelTitle}>Teks Putusan</h2>
            <div style={s.docMeta}>
              <MetaBadge label="Tahun" value={doc.tahun} />
              <MetaBadge label="Jenis" value={doc.jenis_perkara} />
              <MetaBadge label="Amar" value={doc.amar_putusan} highlight={doc.amar_putusan === "pidana"} />
              <MetaBadge label={`${(doc.text_length/1000).toFixed(0)}K karakter`} value="" />
            </div>
            <input value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="🔍 Cari dalam teks..." style={s.textSearch} />
          </div>
          <div style={s.textBody}
            dangerouslySetInnerHTML={{ __html: highlighted(doc.isi_putusan.replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br/>")) }} />
        </div>

        {/* Right: Annotation form */}
        <div style={{ ...s.panel, display: activeTab === "form" || window.innerWidth > 900 ? "flex" : "none" }}>
          <div style={s.panelHeader}>
            <h2 style={s.panelTitle}>Formulir Anotasi</h2>
            <p style={{ fontSize:"0.8rem", color:"var(--muted)" }}>Pakar: <strong>{expert.name}</strong></p>
            <div style={s.aiAssistBar}>
              <button onClick={runAutoTag} disabled={aiSuggesting} style={s.aiBtn}>
                {aiSuggesting ? "Gemini menganalisis..." : "Auto-tag dengan Gemini"}
              </button>
              {!!aiStatus && <span style={s.aiStatus}>{aiStatus}</span>}
            </div>
          </div>
          <div style={s.formBody}>

            {/* Section 1: Overall rating */}
            <FormSection title="1. Penilaian Keseluruhan" icon="⭐">
              <Label>Nilai kepatuhan HAM putusan ini (1–5 bintang)</Label>
              <div style={{ display:"flex", gap:"0.5rem", marginBottom:"1rem" }}>
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setAnn(a => ({...a, overall_rating: n}))}
                    style={{ ...s.starBtn, color: n <= ann.overall_rating ? "#c8922a" : "#d4c9b0", fontSize:"1.6rem", background:"none", border:"none", cursor:"pointer" }}>
                    {n <= ann.overall_rating ? "★" : "☆"}
                  </button>
                ))}
                {ann.overall_rating > 0 && <span style={{ alignSelf:"center", fontSize:"0.8rem", color:"var(--muted)" }}>{["","Sangat Buruk","Buruk","Cukup","Baik","Sangat Baik"][ann.overall_rating]}</span>}
              </div>
              <Label>Catatan penilaian keseluruhan</Label>
              <Textarea value={ann.overall_notes} onChange={v => setAnn(a => ({...a, overall_notes:v}))}
                placeholder="Jelaskan penilaian Anda secara umum terhadap putusan ini..." rows={3} />
            </FormSection>

            {/* Section 2: HAM parameters */}
            <FormSection title="2. Parameter HAM yang Ditemukan" icon="🏷">
              <p style={{ fontSize:"0.8rem", color:"var(--muted)", marginBottom:"1rem" }}>
                Centang parameter HAM yang <strong>secara eksplisit atau implisit</strong> dipertimbangkan dalam putusan ini.
              </p>
              {categories.map(cat => (
                <div key={cat} style={{ marginBottom:"1rem" }}>
                  <div style={s.catLabel}>{cat}</div>
                  {hamParams.filter(p => p.kategori === cat).map(param => (
                    <div key={param.id} style={{ ...s.paramRow, ...(ann.ham_parameters_found.includes(param.id) ? s.paramRowActive : {}) }}
                      onClick={() => toggleHAM(param.id)}>
                      <input type="checkbox" readOnly checked={ann.ham_parameters_found.includes(param.id)}
                        style={{ accentColor:"var(--green)", marginTop:2, flexShrink:0 }} />
                      <div>
                        <div style={{ fontWeight:600, fontSize:"0.85rem" }}>{param.sub_kategori}</div>
                        <div style={{ fontSize:"0.75rem", color:"var(--muted)", lineHeight:1.5 }}>{param.kaidah_hukum?.slice(0,120)}...</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </FormSection>

            {/* Section 3: Specific HAM areas */}
            <FormSection title="3. Area HAM Spesifik" icon="⚖">
              {[
                { key:"fair_trial_addressed", label:"Fair Trial (Peradilan yang Adil)", desc:"Hakim mempertimbangkan hak atas proses peradilan yang adil" },
                { key:"non_discrimination_addressed", label:"Non-Diskriminasi", desc:"Tidak ada perlakuan diskriminatif berdasarkan ras, agama, etnis, dll." },
                { key:"freedom_expression_addressed", label:"Kebebasan Berekspresi", desc:"Putusan mempertimbangkan keseimbangan antara ekspresi dan pembatasan yang sah" },
                { key:"due_process_addressed", label:"Due Process / Proses Hukum yang Benar", desc:"Prosedur hukum diikuti dengan benar" },
              ].map(item => (
                <div key={item.key} style={s.checkRow}
                  onClick={() => setAnn(a => ({...a, [item.key]: !a[item.key as keyof Annotation]}))}>
                  <input type="checkbox" readOnly checked={!!ann[item.key as keyof Annotation]}
                    style={{ accentColor:"var(--green)", marginTop:2, flexShrink:0 }} />
                  <div>
                    <div style={{ fontWeight:600, fontSize:"0.875rem" }}>{item.label}</div>
                    <div style={{ fontSize:"0.775rem", color:"var(--muted)" }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </FormSection>

            {/* Section 4: Compliance score */}
            <FormSection title="4. Skor Kepatuhan HAM" icon="📊">
              <Label>Skor kepatuhan HAM keseluruhan: <strong style={{ color:"var(--gold)" }}>{ann.ham_compliance_score}/100</strong></Label>
              <input type="range" min={0} max={100} value={ann.ham_compliance_score}
                onChange={e => setAnn(a => ({...a, ham_compliance_score: Number(e.target.value)}))}
                style={{ width:"100%", accentColor:"var(--gold)", marginBottom:"0.5rem" }} />
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.75rem", color:"var(--muted)" }}>
                <span>0 — Tidak ada pertimbangan HAM</span><span>100 — Sempurna</span>
              </div>
            </FormSection>

            {/* Section 5: Missing considerations */}
            <FormSection title="5. Pertimbangan yang Terlewatkan" icon="⚠">
              <Label>Prinsip HAM apa yang seharusnya dipertimbangkan hakim tetapi tidak ada dalam putusan?</Label>
              <Textarea value={ann.missing_considerations} onChange={v => setAnn(a => ({...a, missing_considerations:v}))}
                placeholder="Contoh: Hakim tidak mempertimbangkan hak terdakwa atas bantuan hukum di tahap penyidikan (Pasal 56 KUHAP / ICCPR Pasal 14)..." rows={4} />
            </FormSection>

            {/* Section 6: Recommendation */}
            <FormSection title="6. Rekomendasi" icon="💡">
              <Label>Klasifikasi putusan ini</Label>
              <div style={{ display:"flex", flexDirection:"column", gap:"0.5rem", marginBottom:"1rem" }}>
                {[
                  { v:"exemplary", l:"🏆 Teladan — Putusan ini dapat dijadikan referensi HAM", c:"#f0fdf4" },
                  { v:"adequate", l:"✅ Memadai — Cukup baik dalam mempertimbangkan HAM", c:"#fffbeb" },
                  { v:"needs_improvement", l:"⚠ Perlu Perbaikan — Ada aspek HAM yang kurang", c:"#fff7ed" },
                  { v:"non_compliant", l:"❌ Tidak Patuh — Melanggar atau mengabaikan prinsip HAM penting", c:"#fef2f2" },
                ].map(r => (
                  <div key={r.v} onClick={() => setAnn(a => ({...a, recommendation:r.v}))}
                    style={{ ...s.recOption, background: ann.recommendation === r.v ? r.c : "white",
                      borderColor: ann.recommendation === r.v ? "var(--gold)" : "var(--border)", cursor:"pointer" }}>
                    <input type="radio" readOnly checked={ann.recommendation === r.v} style={{ accentColor:"var(--gold)" }} />
                    <span style={{ fontSize:"0.875rem" }}>{r.l}</span>
                  </div>
                ))}
              </div>

              <Label>Pasal / konvensi yang seharusnya dikutip hakim</Label>
              <Textarea value={ann.suggested_citations} onChange={v => setAnn(a => ({...a, suggested_citations:v}))}
                placeholder="Contoh: ICCPR Pasal 14 ayat 3(d), UUD 1945 Pasal 28D, Pasal 56 KUHAP..." rows={3} />
            </FormSection>

            {/* Submit */}
            <div style={s.submitArea}>
              <button onClick={() => save("in_progress")} disabled={saving} style={s.draftBtn}>
                💾 Simpan Draft
              </button>
              <button onClick={() => save("completed")} disabled={saving || !ann.recommendation || ann.overall_rating === 0}
                style={{ ...s.submitBtn, opacity: (!ann.recommendation || ann.overall_rating === 0) ? 0.5 : 1 }}>
                ✓ Selesaikan Anotasi
              </button>
            </div>
            {(!ann.recommendation || ann.overall_rating === 0) && (
              <p style={{ fontSize:"0.75rem", color:"var(--muted)", textAlign:"center", marginTop:"0.5rem" }}>
                Lengkapi penilaian bintang dan rekomendasi untuk menyelesaikan anotasi.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FormSection({ title, icon, children }: { title:string; icon:string; children:React.ReactNode }) {
  return (
    <div style={{ marginBottom:"1.5rem", background:"white", border:"1px solid var(--border)", borderRadius:4, overflow:"hidden" }}>
      <div style={{ background:"var(--cream)", padding:"0.75rem 1.25rem", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:"0.5rem" }}>
        <span>{icon}</span>
        <h3 style={{ fontFamily:"var(--display)", fontSize:"1rem", fontWeight:600 }}>{title}</h3>
      </div>
      <div style={{ padding:"1.25rem" }}>{children}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:"0.8rem", fontWeight:600, letterSpacing:"0.04em", textTransform:"uppercase", color:"var(--muted)", marginBottom:"0.5rem" }}>{children}</div>;
}

function Textarea({ value, onChange, placeholder, rows }: { value:string; onChange:(v:string)=>void; placeholder:string; rows:number }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
      style={{ width:"100%", fontFamily:"var(--serif)", fontSize:"0.875rem", padding:"0.75rem", border:"1px solid var(--border)", borderRadius:3, background:"var(--paper)", lineHeight:1.6, resize:"vertical", outline:"none", marginBottom:"0.75rem" }} />
  );
}

function MetaBadge({ label, value, highlight }: { label:string; value:string; highlight?: boolean }) {
  return (
    <span style={{ fontSize:"0.72rem", background: highlight ? "#fef2f2" : "var(--cream)", border:`1px solid ${highlight ? "#fca5a5" : "var(--border)"}`, color: highlight ? "var(--red)" : "var(--muted)", borderRadius:3, padding:"0.2rem 0.5rem" }}>
      {label}{value ? `: ${value}` : ""}
    </span>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { minHeight:"100vh", background:"var(--paper)", display:"flex", flexDirection:"column" },
  header: { background:"var(--ink)", borderBottom:"2px solid var(--gold)", position:"sticky", top:0, zIndex:100 },
  backBtn: { background:"transparent", border:"none", color:"var(--gold-l)", cursor:"pointer", padding:"0.5rem 1rem", fontFamily:"var(--serif)", fontSize:"0.875rem" },
  headerCenter: { display:"flex", alignItems:"center", gap:"0.75rem", flex:1, padding:"0 1rem", overflow:"hidden" },
  courtTag: { background:"rgba(255,255,255,0.1)", color:"var(--gold-l)", fontSize:"0.7rem", padding:"0.2rem 0.5rem", borderRadius:3, whiteSpace:"nowrap" },
  docTitle: { color:"rgba(255,255,255,0.8)", fontSize:"0.8rem", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  headerRight: { display:"flex", gap:"0.75rem", alignItems:"center", padding:"0 1rem", flexShrink:0 },
  savedBadge: { color:"#86efac", fontSize:"0.8rem", fontWeight:600 },
  saveBtn: { background:"var(--gold)", color:"var(--ink)", border:"none", padding:"0.4rem 1rem", borderRadius:3, cursor:"pointer", fontFamily:"var(--serif)", fontSize:"0.8rem", fontWeight:600 },
  logoutBtn: { background:"transparent", border:"1px solid rgba(255,255,255,0.2)", color:"rgba(255,255,255,0.5)", padding:"0.35rem 0.75rem", borderRadius:3, cursor:"pointer", fontSize:"0.75rem" },
  tabs: { display:"flex", background:"white", borderBottom:"1px solid var(--border)" },
  tab: { flex:1, padding:"0.75rem", border:"none", background:"none", cursor:"pointer", fontFamily:"var(--serif)", fontSize:"0.875rem", color:"var(--muted)", display:"flex", alignItems:"center", justifyContent:"center", gap:"0.5rem" },
  tabActive: { color:"var(--ink)", fontWeight:600, borderBottom:"2px solid var(--gold)" },
  tabBadge: { background:"var(--gold)", color:"var(--ink)", borderRadius:10, padding:"0.1rem 0.4rem", fontSize:"0.7rem", fontWeight:700 },
  body: { display:"grid", gridTemplateColumns:"1fr 1fr", flex:1, minHeight:0 },
  panel: { flexDirection:"column", overflow:"hidden", borderRight:"1px solid var(--border)" },
  panelHeader: { padding:"1rem 1.5rem", borderBottom:"1px solid var(--border)", background:"var(--cream)", flexShrink:0 },
  panelTitle: { fontFamily:"var(--display)", fontSize:"1.1rem", fontWeight:700, marginBottom:"0.5rem" },
  aiAssistBar: { display:"flex", gap:"0.6rem", alignItems:"center", marginTop:"0.6rem", flexWrap:"wrap" },
  aiBtn: { border:"1px solid var(--gold)", background:"#fffdf6", color:"var(--gold)", borderRadius:3, padding:"0.35rem 0.65rem", fontSize:"0.76rem", cursor:"pointer" },
  aiStatus: { fontSize:"0.72rem", color:"var(--muted)" },
  docMeta: { display:"flex", gap:"0.5rem", flexWrap:"wrap", marginBottom:"0.75rem" },
  textSearch: { width:"100%", padding:"0.4rem 0.75rem", border:"1px solid var(--border)", borderRadius:20, background:"white", fontSize:"0.8rem", outline:"none" },
  textBody: { flex:1, overflow:"auto", padding:"1.5rem", fontFamily:"var(--serif)", fontSize:"0.875rem", lineHeight:1.85, color:"var(--ink)", whiteSpace:"pre-wrap" },
  formBody: { flex:1, overflow:"auto", padding:"1rem" },
  catLabel: { fontSize:"0.7rem", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"var(--gold)", marginBottom:"0.5rem", paddingBottom:"0.3rem", borderBottom:"1px solid var(--border)" },
  paramRow: { display:"flex", gap:"0.75rem", padding:"0.6rem", borderRadius:3, cursor:"pointer", marginBottom:"0.4rem", border:"1px solid transparent", transition:"all 0.15s" },
  paramRowActive: { background:"#f0fdf4", border:"1px solid #86efac" },
  checkRow: { display:"flex", gap:"0.75rem", padding:"0.75rem", border:"1px solid var(--border)", borderRadius:3, cursor:"pointer", marginBottom:"0.5rem", transition:"all 0.15s" },
  recOption: { display:"flex", gap:"0.75rem", alignItems:"center", padding:"0.75rem", border:"1px solid", borderRadius:3, transition:"all 0.15s" },
  submitArea: { display:"flex", gap:"1rem", marginTop:"1rem" },
  draftBtn: { flex:1, padding:"0.85rem", background:"var(--cream)", border:"1px solid var(--border)", borderRadius:3, cursor:"pointer", fontFamily:"var(--serif)", fontSize:"0.9rem" },
  submitBtn: { flex:2, padding:"0.85rem", background:"var(--green)", color:"white", border:"none", borderRadius:3, cursor:"pointer", fontFamily:"var(--serif)", fontSize:"0.9rem", fontWeight:600 },
  starBtn: { padding:0, lineHeight:1 },
};
