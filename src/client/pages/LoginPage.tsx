// src/client/pages/LoginPage.tsx
import { useState } from "react";
import type { Expert } from "../App";

interface Props { onLogin: (e: Expert) => void; }

export function LoginPage({ onLogin }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: code.trim().toUpperCase() })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Login gagal"); return; }
      onLogin(data.expert);
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.root}>
      {/* Left panel — decorative */}
      <div style={styles.left}>
        <div style={styles.leftInner}>
          <div style={styles.emblem}>⚖</div>
          <h1 style={styles.title}>Platform Anotasi<br />Putusan HAM</h1>
          <p style={styles.subtitle}>
            Validasi kepatuhan prinsip Hak Asasi Manusia<br />
            dalam putusan pengadilan Indonesia
          </p>
          <div style={styles.divider} />
          <div style={styles.stats}>
            <Stat n="541" label="Putusan" />
            <Stat n="16" label="Parameter HAM" />
            <Stat n="20" label="Sampel Validasi" />
          </div>
          <p style={styles.credit}>
            Proyek Riset — Sistem AI Pendukung Keputusan Hakim<br />
            <span style={{ opacity: 0.6, fontSize: "0.75rem" }}>
              Didukung oleh LeIP & Norwegian Centre for Human Rights
            </span>
          </p>
        </div>
      </div>

      {/* Right panel — login form */}
      <div style={styles.right}>
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>Masuk sebagai Pakar</h2>
            <p style={styles.cardSub}>
              Masukkan kode undangan yang Anda terima melalui email
            </p>
          </div>

          <form onSubmit={handleSubmit} style={styles.form}>
            <label style={styles.label}>Kode Undangan</label>
            <input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="contoh: MRA-A4B2C3"
              style={styles.input}
              autoComplete="off"
              autoFocus
              spellCheck={false}
            />
            {error && <p style={styles.error}>⚠ {error}</p>}
            <button type="submit" disabled={loading || !code.trim()} style={styles.btn}>
              {loading ? "Memverifikasi..." : "Masuk ke Platform →"}
            </button>
          </form>

          <div style={styles.footer}>
            <p style={styles.footerText}>
              Belum memiliki kode undangan?<br />
              Hubungi tim peneliti untuk mendapatkan akses.
            </p>
            <div style={styles.footerBadge}>🔒 Data terenkripsi & tersimpan aman</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontFamily: "var(--display)", fontSize: "2rem", fontWeight: 700, color: "var(--gold-l)" }}>{n}</div>
      <div style={{ fontSize: "0.75rem", opacity: 0.7, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex", minHeight: "100vh",
  },
  left: {
    flex: "0 0 45%", background: "var(--ink)",
    color: "var(--paper)", padding: "3rem",
    display: "flex", alignItems: "center", justifyContent: "center",
    position: "relative", overflow: "hidden",
  },
  leftInner: {
    maxWidth: 380, zIndex: 1,
  },
  emblem: {
    fontSize: "3rem", marginBottom: "1.5rem", display: "block",
    filter: "drop-shadow(0 0 12px rgba(200,146,42,0.4))",
  },
  title: {
    fontFamily: "var(--display)", fontSize: "2.2rem",
    fontWeight: 700, lineHeight: 1.2, marginBottom: "1rem",
    color: "white",
  },
  subtitle: {
    fontSize: "1rem", opacity: 0.75, lineHeight: 1.6, marginBottom: "2rem",
  },
  divider: {
    height: 1, background: "rgba(200,146,42,0.4)", marginBottom: "2rem",
  },
  stats: {
    display: "flex", gap: "2rem", marginBottom: "3rem",
  },
  credit: {
    fontSize: "0.8rem", opacity: 0.55, lineHeight: 1.6,
    borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "1.5rem",
  },
  right: {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
    padding: "2rem", background: "var(--paper)",
  },
  card: {
    width: "100%", maxWidth: 440,
    background: "white",
    border: "1px solid var(--border)",
    borderRadius: 4,
    boxShadow: "0 4px 24px var(--shadow)",
    overflow: "hidden",
  },
  cardHeader: {
    padding: "2rem 2rem 1.5rem",
    borderBottom: "1px solid var(--border)",
    background: "var(--cream)",
  },
  cardTitle: {
    fontFamily: "var(--display)", fontSize: "1.5rem",
    fontWeight: 600, marginBottom: "0.5rem",
  },
  cardSub: {
    fontSize: "0.875rem", color: "var(--muted)", lineHeight: 1.5,
  },
  form: {
    padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem",
  },
  label: {
    fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.06em",
    textTransform: "uppercase", color: "var(--muted)",
  },
  input: {
    fontFamily: "var(--mono)", fontSize: "1.1rem",
    padding: "0.85rem 1rem", border: "2px solid var(--border)",
    borderRadius: 3, background: "var(--paper)",
    letterSpacing: "0.1em", outline: "none",
    transition: "border-color 0.2s",
  },
  error: {
    color: "var(--red)", fontSize: "0.875rem", background: "#fef2f2",
    padding: "0.75rem 1rem", borderRadius: 3, border: "1px solid #fca5a5",
  },
  btn: {
    background: "var(--ink)", color: "var(--gold-l)",
    border: "none", borderRadius: 3, padding: "1rem",
    fontFamily: "var(--serif)", fontSize: "1rem", fontWeight: 600,
    cursor: "pointer", transition: "all 0.2s", letterSpacing: "0.02em",
    marginTop: "0.5rem",
  },
  footer: {
    padding: "1.5rem 2rem", borderTop: "1px solid var(--border)",
    background: "var(--cream)",
  },
  footerText: {
    fontSize: "0.8rem", color: "var(--muted)", lineHeight: 1.6, marginBottom: "1rem",
  },
  footerBadge: {
    fontSize: "0.75rem", color: "var(--green)", background: "#f0fdf4",
    padding: "0.4rem 0.75rem", borderRadius: 20,
    border: "1px solid #bbf7d0", display: "inline-block",
  },
};
