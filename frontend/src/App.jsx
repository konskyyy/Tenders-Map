// frontend/src/App.jsx
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

  // sprawdzenie tokenu przy starcie
  useEffect(() => {
    async function boot() {
      try {
        if (!getToken()) {
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

  // ===== Widok "sprawdzam token" =====
  if (mode === "checking") {
    return (
      <div style={pageStyle}>
        <div style={{ color: "white", opacity: 0.85 }}>Sprawdzam sesję...</div>
      </div>
    );
  }

  // ===== Widok logowania (BEZ REJESTRACJI) =====
  if (mode === "login") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: 22, color: "white" }}>Logowanie</h2>
          <p style={{ marginTop: 8, opacity: 0.8, color: "white" }}>
            Wpisz login i hasło.
          </p>

          {err ? (
            <div style={errorStyle}>
              {err}
            </div>
          ) : null}

          <form onSubmit={onLoginSubmit} style={{ marginTop: 14 }}>
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="Login"
              autoComplete="username"
              style={inputStyle}
            />

            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Hasło"
              type="password"
              autoComplete="current-password"
              style={{ ...inputStyle, marginTop: 10 }}
            />

            <button type="submit" disabled={loading} style={buttonStyle(loading)}>
              {loading ? "Loguję..." : "Zaloguj"}
            </button>
          </form>

          <p style={{ marginTop: 14, opacity: 0.75, fontSize: 13, color: "white" }}>
            Konta użytkowników są zakładane przez administratora.
          </p>
        </div>
      </div>
    );
  }

  // ===== Widok aplikacji po zalogowaniu (tu podłączysz mapę) =====
  return (
    <div style={{ minHeight: "100vh", background: "#0b1220", color: "white", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          Zalogowano jako: <b>{user?.email}</b>
        </div>
        <button onClick={logout} style={{ padding: "8px 12px", borderRadius: 10 }}>
          Wyloguj
        </button>
      </div>

      <div style={{ marginTop: 16, opacity: 0.8 }}>
        Tu podepniesz mapę (frontend dalej działa, tylko usunęliśmy rejestrację).
      </div>
    </div>
  );
}

const pageStyle = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: 16,
  background: "#0b1220",
};

const cardStyle = {
  width: "min(420px, 100%)",
  background: "#122033",
  borderRadius: 16,
  padding: 20,
  boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.06)",
};

const inputStyle = {
  width: "100%",
  height: 44,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  padding: "0 12px",
  outline: "none",
};

const errorStyle = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  background: "rgba(255,0,0,0.12)",
  border: "1px solid rgba(255,0,0,0.35)",
  color: "rgba(255,255,255,0.95)",
};

const buttonStyle = (loading) => ({
  marginTop: 14,
  width: "100%",
  height: 44,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  fontWeight: 700,
  cursor: loading ? "not-allowed" : "pointer",
});
