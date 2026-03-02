// src/client/App.tsx
import { useState, useEffect } from "react";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AnnotatePage } from "./pages/AnnotatePage";

type Page = "login" | "dashboard" | { name: "annotate"; docId: string };

export interface Expert {
  id: string; name: string; email: string; institution: string;
}

export function App() {
  const [expert, setExpert] = useState<Expert | null>(null);
  const [page, setPage] = useState<Page>("login");
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(data => {
        if (data.expert) {
          setExpert(data.expert);
          setPage("dashboard");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Hash-based routing
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#/annotate/") && expert) {
        const docId = decodeURIComponent(hash.replace("#/annotate/", ""));
        setPage({ name: "annotate", docId });
      } else if (hash === "#/dashboard" && expert) {
        setPage("dashboard");
      }
    };
    window.addEventListener("hashchange", handleHash);
    handleHash();
    return () => window.removeEventListener("hashchange", handleHash);
  }, [expert]);

  const navigate = (p: Page) => {
    setPage(p);
    if (p === "dashboard") window.location.hash = "#/dashboard";
    else if (typeof p === "object" && p.name === "annotate")
      window.location.hash = `#/annotate/${encodeURIComponent(p.docId)}`;
  };

  const handleLogin = (e: Expert) => {
    setExpert(e);
    navigate("dashboard");
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setExpert(null);
    setPage("login");
    window.location.hash = "";
  };

  if (loading) return null;

  if (!expert || page === "login") {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (page === "dashboard") {
    return <DashboardPage expert={expert} onNavigate={navigate} onLogout={handleLogout} />;
  }

  if (typeof page === "object" && page.name === "annotate") {
    return <AnnotatePage docId={page.docId} expert={expert}
      onBack={() => navigate("dashboard")} onLogout={handleLogout} />;
  }

  return null;
}
