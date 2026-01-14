import { useEffect, useState } from "react";
import "./App.css";
import { getToken, loginRequest, meRequest, setToken } from "./api";

export default function App() {
  const [mode, setMode] = useState("checking"); // checking | login | app
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    async function boot() {
      try {
        const token = getToken();
        if (!token) {
          setMode("login");
          return;
        }
        const me = await meRequest();
        setUser(me.user);
        setMode("app");
      } catch {
        setToken(null);
        setMode("login");
      }
    }
    boot();
  }, []);

  async function onLoginSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);

    try {
      const data = await loginRequest(login, password);
      setToken(data.token);
      setUser(data.user);
      setMode("app");
    } catch (e2) {
      setErr(e2?.message || "Błąd logowania");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setToken(null);
    setUser(null);
    setLogin("");
    setPassword("");
    setErr("");
    setMode("login");
  }

  if (mode === "checking") {
    return (
      <div style={pageStyle}>
        <div style={{ color: "white", opacity: 0.85 }}>Sprawdzam sesję...</div>
      </div>
    );
  }

  if (mode === "login") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={brandRow}>
            <div style={brandDot} />
            <div style={{ color: "white", fontWeight: 800, letterSpacing: 0.2 }}>
              Tenders Map
            </div>
          </div>

          <h2 style={{ margin: "10px 0 0", fontSize: 22, color: "white" }}>
            Logowanie
          </h2>
          <p style={{ marginTop: 8, opacity: 0.82, color: "white" }}>
            Wpisz login i hasło.
          </p>

          {err ? <div style={errorStyle}>{err}</div> : null}

          <form onSubmit={onLoginSubmit} style={{ marginTop: 14 }}>
            <label style={labelStyle}>Login</label>
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="np. admin"
              autoComplete="username"
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 10 }}>Hasło</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              type="password"
              autoComplete="current-password"
              style={inputStyle}
            />

            <button type="submit" disabled={loading} style={primaryButtonStyle(loading)}>
              {loading ? "Loguję..." : "Zaloguj"}
            </button>
          </form>

          <div style={hintStyle}>
            Konta użytkowników są zakładane przez administratora.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={appShellStyle}>
      <div style={topBarStyle}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={brandDot} />
          <div style={{ fontWeight: 800 }}>Tenders Map</div>
          <div style={{ opacity: 0.75, fontSize: 13 }}>
            Zalogowano jako: <b style={{ opacity: 0.95 }}>{user?.email}</b>
          </div>
        </div>

        <button onClick={logout} style={secondaryButtonStyle}>
          Wyloguj
        </button>
      </div>

      <div style={contentStyle}>
        <div style={contentCardStyle}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Twoja aplikacja</div>
          <div style={{ opacity: 0.8 }}>
            Tu podepniesz mapę i punkty. Logowanie jest gotowe.
          </div>
        </div>
      </div>
    </div>
  );
}

/** ===== styles ===== */

const pageStyle = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: 16,
  // lepsze tło
  background:
    "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.22), transparent 60%)," +
    "radial-gradient(900px 500px at 85% 20%, rgba(34,197,94,0.14), transparent 55%)," +
    "radial-gradient(900px 500px at 40% 95%, rgba(59,130,246,0.16), transparent 55%)," +
    "linear-gradient(180deg, #070B14 0%, #0B1220 45%, #070B14 100%)",
};

const cardStyle = {
  width: "min(420px, 100%)",
  background: "rgba(18, 32, 51, 0.72)",
  borderRadius: 18,
  padding: 20,
  boxShadow: "0 18px 55px rgba(0,0,0,0.45)",
  border: "1px solid rgba(255,255,255,0.10)",
  backdropFilter: "blur(10px)",
};

const brandRow = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const brandDot = {
  width: 12,
  height: 12,
  borderRadius: 999,
  background: "rgba(255,255,255,0.85)",
  boxShadow: "0 0 0 6px rgba(255,255,255,0.08)",
};

const labelStyle = {
  display: "block",
  color: "rgba(255,255,255,0.85)",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
};

const inputStyle = {
  width: "100%",
  height: 44,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  padding: "0 12px",
  outline: "none",
};

const errorStyle = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  background: "rgba(255, 59, 59, 0.16)",
  border: "1px solid rgba(255, 59, 59, 0.40)",
  color: "rgba(255,255,255,0.96)",
};

const primaryButtonStyle = (loading) => ({
  marginTop: 14,
  width: "100%",
  height: 44,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.10)",
  color: "white",
  fontWeight: 800,
  cursor: loading ? "not-allowed" : "pointer",
});

const hintStyle = {
  marginTop: 14,
  opacity: 0.78,
  fontSize: 13,
  color: "white",
};

const appShellStyle = {
  minHeight: "100vh",
  background:
    "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.18), transparent 60%)," +
    "radial-gradient(900px 500px at 85% 20%, rgba(34,197,94,0.10), transparent 55%)," +
    "linear-gradient(180deg, #070B14 0%, #0B1220 55%, #070B14 100%)",
  color: "white",
};

const topBarStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: 16,
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(10, 16, 29, 0.45)",
  backdropFilter: "blur(10px)",
};

const secondaryButtonStyle = {
  height: 40,
  padding: "0 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const contentStyle = {
  padding: 16,
};

const contentCardStyle = {
  maxWidth: 900,
  margin: "0 auto",
  padding: 16,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(18, 32, 51, 0.55)",
  backdropFilter: "blur(10px)",
};
