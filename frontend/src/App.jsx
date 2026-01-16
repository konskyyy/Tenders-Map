import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { API_BASE, getToken, loginRequest, meRequest, setToken } from "./api";

import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
  ZoomControl,
  GeoJSON,
  FeatureGroup,
  Polyline,
} from "react-leaflet";
import L from "leaflet";

/** ===== API ===== */
const API = API_BASE.endsWith("/api") ? API_BASE : `${API_BASE}/api`;

/** ===== UI CONSTS ===== */
const TEXT_LIGHT = "#ffffff";
const BORDER = "rgba(255,255,255,0.12)";
const MUTED = "rgba(255,255,255,0.75)";

// glossy
const GLASS_BG = "rgba(22,42,64,0.70)";
const GLASS_BG_DARK = "rgba(22,42,64,0.90)";
const GLASS_SHADOW = "0 10px 28px rgba(0,0,0,0.35)";
const GLASS_HIGHLIGHT =
  "radial-gradient(700px 400px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)";

/** ===== MAP CONSTS ===== */
const POLAND_BOUNDS = [
  [49.0, 14.1],
  [54.9, 24.2],
];

const STATUSES = [
  { key: "planowany", label: "Planowany", color: "#3b82f6" },
  { key: "przetarg", label: "Przetarg", color: "#f59e0b" },
  { key: "realizacja", label: "Realizacja", color: "#22c55e" },
  { key: "nieaktualny", label: "Nieaktualny", color: "#9ca3af" },
];

// Natural Earth (GeoJSON) – granice państw
const NE_COUNTRIES_URL =
  "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_countries.geojson";
const KEEP_COUNTRIES_A3 = new Set(["POL", "LTU", "LVA", "EST"]);

function ClickHandler({ enabled, onAdd }) {
  useMapEvents({
    click(e) {
      if (!enabled) return;
      onAdd(e.latlng);
    },
  });
  return null;
}

function statusLabel(s) {
  if (s === "przetarg") return "przetarg";
  if (s === "realizacja") return "realizacja";
  if (s === "nieaktualny") return "nieaktualny";
  return "planowany";
}

function statusColor(status) {
  if (status === "przetarg") return "#f59e0b";
  if (status === "realizacja") return "#22c55e";
  if (status === "nieaktualny") return "#9ca3af";
  return "#3b82f6";
}

function tunnelColor(status) {
  return statusColor(status);
}

function pinSvg(color) {
  return `
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none"
       xmlns="http://www.w3.org/2000/svg">
    <path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"
          fill="${color}"/>
    <circle cx="12" cy="10" r="2.6" fill="white" fill-opacity="0.95"/>
    <circle cx="12" cy="10" r="1.4" fill="rgba(0,0,0,0.25)"/>
  </svg>`;
}

function makePinIcon(color) {
  return L.divIcon({
    className: "",
    html: pinSvg(color),
    iconSize: [34, 34],
    iconAnchor: [17, 32],
    popupAnchor: [0, -28],
  });
}

function InfoCard({ label, value, placeholder }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: `1px solid ${BORDER}`,
        background: "rgba(255,255,255,0.06)",
        padding: 10,
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12, color: MUTED }}>{label}</div>
      <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.95)" }}>
        {value?.trim?.() ? (
          value
        ) : (
          <span style={{ color: "rgba(255,255,255,0.6)" }}>{placeholder}</span>
        )}
      </div>
    </div>
  );
}

function extractOuterRings(geometry) {
  if (!geometry) return [];
  const { type, coordinates } = geometry;

  if (type === "Polygon") {
    return coordinates?.[0] ? [coordinates[0]] : [];
  }
  if (type === "MultiPolygon") {
    const rings = [];
    for (const poly of coordinates || []) {
      if (poly?.[0]) rings.push(poly[0]);
    }
    return rings;
  }
  return [];
}

/** ===== helper: JSON-safe ===== */
async function readJsonOrThrow(res) {
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const head = (text || "").slice(0, 160).replace(/\s+/g, " ");
    const err = new Error(
      `API nie zwróciło JSON (HTTP ${res.status}). Początek: ${head || "(pusto)"}`
    );
    err.status = res.status;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return data;
}

function toPath(latlngs) {
  const arr = Array.isArray(latlngs) ? latlngs : [];
  return arr.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
}

export default function App() {
  /** ===== Leaflet Draw FIX (L is not defined) ===== */
  const [EditControl, setEditControl] = useState(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        // leaflet-draw wymaga globalnego L
        window.L = L;

        // 1) plugin
        await import("leaflet-draw");

        // 2) wrapper reactowy
        const mod = await import("react-leaflet-draw");

        if (!alive) return;
        setEditControl(() => mod.EditControl);
      } catch (e) {
        console.error("Leaflet draw init failed:", e);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  /** ===== AUTH ===== */
  const [mode, setMode] = useState("checking"); // checking | login | app
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [user, setUser] = useState(null);
  const [authNotice, setAuthNotice] = useState("");

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
    setLoadingAuth(true);

    try {
      const data = await loginRequest(login, password);
      setToken(data.token);
      setUser(data.user);
      setAuthNotice("");
      setMode("app");
    } catch (e2) {
      setErr(e2?.message || "Błąd logowania");
    } finally {
      setLoadingAuth(false);
    }
  }

  function logout(reason) {
    setToken(null);
    setUser(null);
    setLogin("");
    setPassword("");
    setErr("");
    setMode("login");

    setSelectedPointId(null);
    setPoints([]);

    setSelectedTunnelId(null);
    setTunnels([]);

    if (reason === "expired") setAuthNotice("Sesja wygasła — zaloguj się ponownie.");
    else setAuthNotice("");
  }

  async function authFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    return fetch(url, { ...options, headers });
  }

  /** ===== POINTS ===== */
  const [points, setPoints] = useState([]);
  const [selectedPointId, setSelectedPointId] = useState(null);

  const selectedPoint = useMemo(
    () => points.find((p) => p.id === selectedPointId) || null,
    [points, selectedPointId]
  );

  const [pointForm, setPointForm] = useState({
    title: "",
    director: "",
    winner: "",
    note: "",
    status: "planowany",
  });

  const [savingPoint, setSavingPoint] = useState(false);
  const [busyDeletePoint, setBusyDeletePoint] = useState(false);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [apiError, setApiError] = useState("");

  const pinIcons = useMemo(() => {
    return {
      planowany: makePinIcon(statusColor("planowany")),
      przetarg: makePinIcon(statusColor("przetarg")),
      realizacja: makePinIcon(statusColor("realizacja")),
      nieaktualny: makePinIcon(statusColor("nieaktualny")),
    };
  }, []);

  /** ===== TUNNELS ===== */
  const [tunnels, setTunnels] = useState([]);
  const [selectedTunnelId, setSelectedTunnelId] = useState(null);

  const selectedTunnel = useMemo(
    () => tunnels.find((t) => t.id === selectedTunnelId) || null,
    [tunnels, selectedTunnelId]
  );

  const [tunnelForm, setTunnelForm] = useState({
    name: "",
    director: "",
    winner: "",
    status: "planowany",
    note: "",
  });

  const [savingTunnel, setSavingTunnel] = useState(false);
  const [busyDeleteTunnel, setBusyDeleteTunnel] = useState(false);
  const [loadingTunnels, setLoadingTunnels] = useState(false);

  const drawGroupRef = useRef(null);

  /** ===== Filters + Add mode ===== */
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [addMode, setAddMode] = useState("none"); // none | point | tunnel
  const [visibleStatus, setVisibleStatus] = useState({
    planowany: true,
    przetarg: true,
    realizacja: true,
    nieaktualny: true,
  });

  const filteredPoints = useMemo(() => {
    return points.filter((p) => visibleStatus[p.status || "planowany"] !== false);
  }, [points, visibleStatus]);

  const filteredTunnels = useMemo(() => {
    return tunnels.filter((t) => visibleStatus[t.status || "planowany"] !== false);
  }, [tunnels, visibleStatus]);

  const counts = useMemo(() => {
    const c = { planowany: 0, przetarg: 0, realizacja: 0, nieaktualny: 0 };
    for (const p of points) {
      const st = p.status || "planowany";
      c[st] = (c[st] || 0) + 1;
    }
    for (const t of tunnels) {
      const st = t.status || "planowany";
      c[st] = (c[st] || 0) + 1;
    }
    return c;
  }, [points, tunnels]);

  function toggleStatus(key) {
    setVisibleStatus((s) => ({ ...s, [key]: !s[key] }));
  }
  function showAllStatuses() {
    setVisibleStatus({
      planowany: true,
      przetarg: true,
      realizacja: true,
      nieaktualny: true,
    });
  }
  function hideAllStatuses() {
    setVisibleStatus({
      planowany: false,
      przetarg: false,
      realizacja: false,
      nieaktualny: false,
    });
  }

  /** ===== World mask ===== */
  const [worldMask, setWorldMask] = useState(null);
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await fetch(NE_COUNTRIES_URL);
        if (!res.ok) throw new Error(`GeoJSON HTTP ${res.status}`);
        const fc = await res.json();

        const keepFeatures = (fc.features || []).filter((f) => {
          const a3 =
            f?.properties?.ADM0_A3 ||
            f?.properties?.ISO_A3 ||
            f?.properties?.iso_a3;
          return KEEP_COUNTRIES_A3.has(a3);
        });

        const holes = [];
        for (const f of keepFeatures) holes.push(...extractOuterRings(f.geometry));

        const mask = {
          type: "Feature",
          properties: { name: "world-mask" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-180, -90],
                [180, -90],
                [180, 90],
                [-180, 90],
                [-180, -90],
              ],
              ...holes,
            ],
          },
        };

        if (alive) setWorldMask(mask);
      } catch {
        if (alive) setWorldMask(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  /** ===== Load data ===== */
  async function loadPoints() {
    setLoadingPoints(true);
    setApiError("");
    try {
      const res = await authFetch(`${API}/points`);
      const data = await readJsonOrThrow(res);
      setPoints(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę pobrać punktów: ${String(e)}`);
    } finally {
      setLoadingPoints(false);
    }
  }

  async function loadTunnels() {
    setLoadingTunnels(true);
    setApiError("");
    try {
      const res = await authFetch(`${API}/tunnels`);
      const data = await readJsonOrThrow(res);
      setTunnels(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę pobrać tuneli: ${String(e)}`);
    } finally {
      setLoadingTunnels(false);
    }
  }

  useEffect(() => {
    if (mode !== "app") return;
    loadPoints();
    loadTunnels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /** ===== Sync forms ===== */
  useEffect(() => {
    if (!selectedPoint) return;
    setPointForm({
      title: selectedPoint.title || "",
      director: selectedPoint.director || "",
      winner: selectedPoint.winner || "",
      note: selectedPoint.note || "",
      status: selectedPoint.status || "planowany",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPointId]);

  useEffect(() => {
    if (!selectedTunnel) return;
    setTunnelForm({
      name: selectedTunnel.name || "",
      director: selectedTunnel.director || "",
      winner: selectedTunnel.winner || "",
      status: selectedTunnel.status || "planowany",
      note: selectedTunnel.note || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTunnelId]);

  /** ===== Points CRUD ===== */
  async function addPoint(latlng) {
    setApiError("");
    const body = {
      title: "Nowy punkt",
      director: "",
      winner: "",
      note: "",
      status: "planowany",
      lat: latlng.lat,
      lng: latlng.lng,
    };

    try {
      const res = await authFetch(`${API}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJsonOrThrow(res);
      setPoints((p) => [data, ...p]);
      setSelectedPointId(data.id);
      setSelectedTunnelId(null);
      setSidebarOpen(true);
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę dodać punktu: ${String(e)}`);
    }
  }

  async function savePoint() {
    if (!selectedPoint) return;
    setSavingPoint(true);
    setApiError("");
    try {
      const res = await authFetch(`${API}/points/${selectedPoint.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: pointForm.title,
          director: pointForm.director,
          winner: pointForm.winner,
          note: pointForm.note,
          status: pointForm.status,
        }),
      });
      const data = await readJsonOrThrow(res);
      setPoints((prev) => prev.map((p) => (p.id === data.id ? data : p)));
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę zapisać punktu: ${String(e)}`);
    } finally {
      setSavingPoint(false);
    }
  }

  async function deletePoint() {
    if (!selectedPoint) return;
    const ok = window.confirm(`Usunąć punkt #${selectedPoint.id}?`);
    if (!ok) return;

    setBusyDeletePoint(true);
    setApiError("");
    try {
      const res = await authFetch(`${API}/points/${selectedPoint.id}`, {
        method: "DELETE",
      });
      await readJsonOrThrow(res);
      setPoints((prev) => prev.filter((p) => p.id !== selectedPoint.id));
      setSelectedPointId(null);
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę usunąć punktu: ${String(e)}`);
    } finally {
      setBusyDeletePoint(false);
    }
  }

  /** ===== Tunnels CRUD ===== */
  async function saveTunnelMeta() {
    if (!selectedTunnel) return;

    setSavingTunnel(true);
    setApiError("");
    try {
      const res = await authFetch(`${API}/tunnels/${selectedTunnel.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tunnelForm.name,
          director: tunnelForm.director,
          winner: tunnelForm.winner,
          status: tunnelForm.status,
          note: tunnelForm.note,
          path: selectedTunnel.path,
        }),
      });
      const data = await readJsonOrThrow(res);
      setTunnels((prev) => prev.map((t) => (t.id === data.id ? data : t)));
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę zapisać tunelu: ${String(e)}`);
    } finally {
      setSavingTunnel(false);
    }
  }

  async function deleteTunnel(id) {
    const ok = window.confirm(`Usunąć tunel #${id}?`);
    if (!ok) return;

    setBusyDeleteTunnel(true);
    setApiError("");
    try {
      const res = await authFetch(`${API}/tunnels/${id}`, { method: "DELETE" });
      await readJsonOrThrow(res);
      setTunnels((prev) => prev.filter((t) => t.id !== id));
      if (selectedTunnelId === id) setSelectedTunnelId(null);
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę usunąć tunelu: ${String(e)}`);
    } finally {
      setBusyDeleteTunnel(false);
    }
  }

  /** ===== Leaflet Draw handlers ===== */
  async function onDrawCreated(e) {
    if (e.layerType !== "polyline") return;

    const latlngs = e.layer.getLatLngs();
    const path = toPath(latlngs);

    try {
      if (drawGroupRef.current) drawGroupRef.current.clearLayers();
    } catch {}

    setApiError("");
    try {
      const res = await authFetch(`${API}/tunnels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Nowy tunel",
          director: "",
          winner: "",
          status: "planowany",
          note: "",
          path,
        }),
      });
      const data = await readJsonOrThrow(res);
      setTunnels((prev) => [data, ...prev]);
      setSelectedTunnelId(data.id);
      setSelectedPointId(null);
      setSidebarOpen(true);
    } catch (err2) {
      if (err2?.status === 401) return logout("expired");
      setApiError(`Nie mogę dodać tunelu: ${String(err2)}`);
    }
  }

  async function onDrawEdited(e) {
    const layers = e.layers;
    const updates = [];

    layers.eachLayer((layer) => {
      const tunnelId = layer?.options?.tunnelId;
      if (!tunnelId) return;
      const latlngs = layer.getLatLngs();
      const path = toPath(latlngs);
      updates.push({ id: tunnelId, path });
    });

    if (updates.length === 0) return;

    setApiError("");
    try {
      for (const u of updates) {
        const t = tunnels.find((x) => x.id === u.id);
        if (!t) continue;

        const res = await authFetch(`${API}/tunnels/${u.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: t.name || "Tunel",
            director: t.director || "",
            winner: t.winner || "",
            status: t.status || "planowany",
            note: t.note || "",
            path: u.path,
          }),
        });
        const data = await readJsonOrThrow(res);
        setTunnels((prev) => prev.map((x) => (x.id === data.id ? data : x)));
      }
    } catch (err2) {
      if (err2?.status === 401) return logout("expired");
      setApiError(`Nie mogę zapisać geometrii tunelu: ${String(err2)}`);
    }
  }

  async function onDrawDeleted(e) {
    const layers = e.layers;
    const ids = [];

    layers.eachLayer((layer) => {
      const tunnelId = layer?.options?.tunnelId;
      if (tunnelId) ids.push(tunnelId);
    });

    if (ids.length === 0) return;

    const ok = window.confirm(`Usunąć ${ids.length} tunel(e)?`);
    if (!ok) {
      loadTunnels();
      return;
    }

    setApiError("");
    try {
      for (const id of ids) {
        const res = await authFetch(`${API}/tunnels/${id}`, { method: "DELETE" });
        await readJsonOrThrow(res);
      }
      setTunnels((prev) => prev.filter((t) => !ids.includes(t.id)));
      if (ids.includes(selectedTunnelId)) setSelectedTunnelId(null);
    } catch (err2) {
      if (err2?.status === 401) return logout("expired");
      setApiError(`Nie mogę usunąć tunelu: ${String(err2)}`);
      loadTunnels();
    }
  }

  /** ===== LOGIN UI ===== */
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
            <div style={brandText}>Mapa projektów - BD</div>
          </div>

          <h2 style={titleStyle}>Logowanie</h2>
          <p style={subtitleStyle}>Wpisz login i hasło.</p>

          {authNotice ? (
            <div
              style={{
                boxSizing: "border-box",
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                background: "rgba(59, 130, 246, 0.16)",
                border: "1px solid rgba(59, 130, 246, 0.35)",
                color: "rgba(255,255,255,0.96)",
              }}
            >
              {authNotice}
            </div>
          ) : null}

          {err ? <div style={errorStyle}>{err}</div> : null}

          <form onSubmit={onLoginSubmit} style={{ marginTop: 14 }}>
            <label style={labelStyle}>Login</label>
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="np. admin@firma.pl"
              autoComplete="username"
              autoFocus
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

            <button type="submit" disabled={loadingAuth} style={primaryButtonStyle(loadingAuth)}>
              {loadingAuth ? "Loguję..." : "Zaloguj"}
            </button>
          </form>

          <div style={hintStyle}>Konta użytkowników są zakładane przez administratora.</div>
        </div>
      </div>
    );
  }

  /** ===== APP UI ===== */
  const sidebarWidthOpen = 380;
  const sidebarWidthClosed = 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateColumns: `${sidebarOpen ? sidebarWidthOpen : sidebarWidthClosed}px 1fr`,
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* SIDEBAR */}
      <aside
        style={{
          color: TEXT_LIGHT,
          borderRight: sidebarOpen ? `1px solid ${BORDER}` : "none",
          overflow: "hidden",
          width: sidebarOpen ? sidebarWidthOpen : sidebarWidthClosed,
          transition: "width 200ms ease",
          background: GLASS_BG,
          backgroundImage: GLASS_HIGHLIGHT,
          backdropFilter: "blur(8px)",
          boxShadow: GLASS_SHADOW,
        }}
      >
        {sidebarOpen ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 12px",
                borderBottom: `1px solid ${BORDER}`,
                background: GLASS_BG_DARK,
                backdropFilter: "blur(8px)",
              }}
            >
              <button
                onClick={() => setSidebarOpen(false)}
                title="Zwiń panel"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  background: "transparent",
                  color: TEXT_LIGHT,
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 18,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ⟨
              </button>

              <div style={{ display: "grid", gap: 2, flex: 1 }}>
                <div style={{ fontWeight: 800, letterSpacing: 0.2 }}>Mapa projektów - BD</div>
                <div style={{ fontSize: 12, color: MUTED }}>
                  Zalogowano: {user?.email || "(użytkownik)"}
                </div>
              </div>

              <button
                onClick={() => logout()}
                style={{
                  padding: "8px 10px",
                  borderRadius: 12,
                  border: `1px solid ${BORDER}`,
                  background: "rgba(255,255,255,0.06)",
                  color: TEXT_LIGHT,
                  cursor: "pointer",
                  fontWeight: 900,
                  fontSize: 12,
                }}
              >
                Wyloguj
              </button>
            </div>

            <div style={{ padding: 12, height: "calc(100% - 59px)", overflow: "auto" }}>
              {apiError ? (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 14,
                    border: "1px solid rgba(255,120,120,0.45)",
                    background: "rgba(255,120,120,0.12)",
                    color: "rgba(255,255,255,0.95)",
                    fontSize: 12,
                    marginBottom: 10,
                  }}
                >
                  {apiError}
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <button
                  onClick={() => {
                    loadPoints();
                    loadTunnels();
                  }}
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    background: "rgba(255,255,255,0.08)",
                    color: TEXT_LIGHT,
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  {loadingPoints || loadingTunnels ? "Ładuję..." : "Odśwież"}
                </button>

                <button
                  onClick={() => {
                    setSelectedPointId(null);
                    setSelectedTunnelId(null);
                  }}
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    background: "rgba(255,255,255,0.05)",
                    color: TEXT_LIGHT,
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  Odznacz
                </button>
              </div>

              {/* TABS: Dodawanie (mini) */}
              <div
                style={{
                  padding: 10,
                  borderRadius: 14,
                  border: `1px solid ${BORDER}`,
                  background: "rgba(255,255,255,0.05)",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Dodawanie</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button
                    onClick={() => setAddMode((m) => (m === "point" ? "none" : "point"))}
                    style={{
                      padding: "10px 10px",
                      borderRadius: 12,
                      border: `1px solid ${BORDER}`,
                      background: addMode === "point" ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)",
                      color: TEXT_LIGHT,
                      cursor: "pointer",
                      fontWeight: 900,
                    }}
                    title="Kliknij mapę, aby dodać punkt"
                  >
                    🎯 Punkt
                  </button>

                  <button
                    onClick={() => setAddMode((m) => (m === "tunnel" ? "none" : "tunnel"))}
                    style={{
                      padding: "10px 10px",
                      borderRadius: 12,
                      border: `1px solid ${BORDER}`,
                      background: addMode === "tunnel" ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)",
                      color: TEXT_LIGHT,
                      cursor: "pointer",
                      fontWeight: 900,
                    }}
                    title="Rysuj linię na mapie"
                  >
                    🧵 Tunel
                  </button>
                </div>

                <div style={{ marginTop: 8, fontSize: 12, color: MUTED, lineHeight: 1.4 }}>
                  {addMode === "point"
                    ? "Tryb: Punkt — kliknij na mapie, żeby dodać marker."
                    : addMode === "tunnel"
                    ? "Tryb: Tunel — użyj narzędzia rysowania linii (klik/klik/klik i zakończ)."
                    : "Wybierz tryb dodawania: Punkt albo Tunel."}
                </div>
              </div>

              {/* POINT EDIT */}
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Punkt</div>

              <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
                <InfoCard label="Dyrektor kontraktu" value={pointForm.director} placeholder="(nie ustawiono)" />
                <InfoCard label="Firma (wykonawca)" value={pointForm.winner} placeholder="(nie ustawiono)" />
              </div>

              <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                {selectedPoint ? (
                  <>
                    <div style={{ fontSize: 12, color: MUTED }}>Edycja punktu #{selectedPoint.id}</div>

                    <label style={{ fontSize: 12, color: MUTED }}>Tytuł</label>
                    <input
                      value={pointForm.title}
                      onChange={(e) => setPointForm((f) => ({ ...f, title: e.target.value }))}
                      style={fieldStyle}
                    />

                    <label style={{ fontSize: 12, color: MUTED }}>Dyrektor kontraktu</label>
                    <input
                      value={pointForm.director}
                      onChange={(e) => setPointForm((f) => ({ ...f, director: e.target.value }))}
                      style={fieldStyle}
                    />

                    <label style={{ fontSize: 12, color: MUTED }}>Firma (wykonawca)</label>
                    <input
                      value={pointForm.winner}
                      onChange={(e) => setPointForm((f) => ({ ...f, winner: e.target.value }))}
                      style={fieldStyle}
                    />

                    <label style={{ fontSize: 12, color: MUTED }}>Notatka</label>
                    <textarea
                      rows={5}
                      value={pointForm.note}
                      onChange={(e) => setPointForm((f) => ({ ...f, note: e.target.value }))}
                      style={{ ...fieldStyle, resize: "vertical" }}
                    />

                    <label style={{ fontSize: 12, color: MUTED }}>Status</label>
                    <select
                      value={pointForm.status}
                      onChange={(e) => setPointForm((f) => ({ ...f, status: e.target.value }))}
                      style={fieldStyle}
                    >
                      <option value="planowany">planowany</option>
                      <option value="przetarg">przetarg</option>
                      <option value="realizacja">realizacja</option>
                      <option value="nieaktualny">nieaktualny</option>
                    </select>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                      <button onClick={savePoint} disabled={savingPoint} style={btnStyle(savingPoint)}>
                        {savingPoint ? "Zapisuję..." : "Zapisz"}
                      </button>

                      <button onClick={deletePoint} disabled={busyDeletePoint} style={dangerBtnStyle(busyDeletePoint)}>
                        {busyDeletePoint ? "Usuwam..." : "Usuń"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={emptyBoxStyle}>Wybierz punkt (kliknij marker lub pozycję na liście).</div>
                )}
              </div>

              <div style={{ height: 1, background: BORDER, margin: "10px 0" }} />

              {/* TUNNEL EDIT */}
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Tunel (linia)</div>

              <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                {selectedTunnel ? (
                  <>
                    <div style={{ fontSize: 12, color: MUTED }}>Edycja tunelu #{selectedTunnel.id}</div>

                    <label style={{ fontSize: 12, color: MUTED }}>Nazwa</label>
                    <input
                      value={tunnelForm.name}
                      onChange={(e) => setTunnelForm((f) => ({ ...f, name: e.target.value }))}
                      style={fieldStyle}
                    />

                    <label style={{ fontSize: 12, color: MUTED }}>Dyrektor kontraktu</label>
                    <input
                      value={tunnelForm.director}
                      onChange={(e) => setTunnelForm((f) => ({ ...f, director: e.target.value }))}
                      style={fieldStyle}
                    />

                    <label style={{ fontSize: 12, color: MUTED }}>Firma (wykonawca)</label>
                    <input
                      value={tunnelForm.winner}
                      onChange={(e) => setTunnelForm((f) => ({ ...f, winner: e.target.value }))}
                      style={fieldStyle}
                    />

                    <label style={{ fontSize: 12, color: MUTED }}>Notatka</label>
                    <textarea
                      rows={4}
                      value={tunnelForm.note}
                      onChange={(e) => setTunnelForm((f) => ({ ...f, note: e.target.value }))}
                      style={{ ...fieldStyle, resize: "vertical" }}
                    />

                    <label style={{ fontSize: 12, color: MUTED }}>Status</label>
                    <select
                      value={tunnelForm.status}
                      onChange={(e) => setTunnelForm((f) => ({ ...f, status: e.target.value }))}
                      style={fieldStyle}
                    >
                      <option value="planowany">planowany</option>
                      <option value="przetarg">przetarg</option>
                      <option value="realizacja">realizacja</option>
                      <option value="nieaktualny">nieaktualny</option>
                    </select>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <button onClick={saveTunnelMeta} disabled={savingTunnel} style={btnStyle(savingTunnel)}>
                        {savingTunnel ? "Zapisuję..." : "Zapisz"}
                      </button>

                      <button
                        onClick={() => deleteTunnel(selectedTunnel.id)}
                        disabled={busyDeleteTunnel}
                        style={dangerBtnStyle(busyDeleteTunnel)}
                      >
                        {busyDeleteTunnel ? "Usuwam..." : "Usuń"}
                      </button>
                    </div>

                    <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.4 }}>
                      Geometrię edytujesz na mapie: włącz tryb <b>tunnel</b> i użyj ikonki <b>Edit</b>.
                    </div>
                  </>
                ) : (
                  <div style={emptyBoxStyle}>Wybierz tunel (kliknij linię na mapie lub na liście).</div>
                )}
              </div>

              <div style={{ height: 1, background: BORDER, margin: "10px 0" }} />

              {/* LISTS */}
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Lista (tunel + punkty)</div>

              <div style={{ display: "grid", gap: 8 }}>
                {filteredTunnels.map((t) => (
                  <div
                    key={`t-${t.id}`}
                    onClick={() => {
                      setSelectedTunnelId(t.id);
                      setSelectedPointId(null);
                      setSidebarOpen(true);
                    }}
                    style={{
                      padding: 10,
                      borderRadius: 14,
                      border:
                        t.id === selectedTunnelId
                          ? `2px solid rgba(255,255,255,0.35)`
                          : `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.05)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 900, display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span>🟦 {t.name || `Tunel #${t.id}`}</span>
                      <span style={pillStyle}>{statusLabel(t.status)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                      węzłów: {Array.isArray(t.path) ? t.path.length : 0}
                    </div>
                  </div>
                ))}

                {filteredPoints.map((pt) => (
                  <div
                    key={`p-${pt.id}`}
                    onClick={() => {
                      setSelectedPointId(pt.id);
                      setSelectedTunnelId(null);
                      setSidebarOpen(true);
                    }}
                    style={{
                      padding: 10,
                      borderRadius: 14,
                      border:
                        pt.id === selectedPointId
                          ? `2px solid rgba(255,255,255,0.35)`
                          : `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.05)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 900, display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span>📍 {pt.title}</span>
                      <span style={pillStyle}>{statusLabel(pt.status)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                      ({Number(pt.lat).toFixed(4)}, {Number(pt.lng).toFixed(4)})
                    </div>
                  </div>
                ))}

                {filteredPoints.length === 0 && filteredTunnels.length === 0 ? (
                  <div style={emptyBoxStyle}>Brak danych dla zaznaczonych statusów.</div>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </aside>

      {/* MAP */}
      <main
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          cursor: addMode === "point" ? "crosshair" : "default",
        }}
      >
        {!sidebarOpen ? (
          <button
            onClick={() => setSidebarOpen(true)}
            title="Pokaż panel"
            style={{
              position: "absolute",
              zIndex: 1500,
              top: 12,
              left: 12,
              height: 44,
              padding: "0 12px",
              borderRadius: 14,
              border: `1px solid ${BORDER}`,
              background: GLASS_BG_DARK,
              color: TEXT_LIGHT,
              cursor: "pointer",
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              gap: 10,
              boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
              backdropFilter: "blur(8px)",
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>⟩</span>
            <span style={{ fontSize: 13 }}>Panel</span>
          </button>
        ) : null}

        {/* STATUSY */}
        <div
          style={{
            position: "absolute",
            zIndex: 1600,
            top: 12,
            right: 12,
            width: 240,
            borderRadius: 16,
            border: `1px solid ${BORDER}`,
            background: GLASS_BG,
            backgroundImage:
              "radial-gradient(500px 300px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
            backdropFilter: "blur(8px)",
            color: TEXT_LIGHT,
            overflow: "hidden",
            boxShadow: GLASS_SHADOW,
          }}
        >
          <div
            onClick={() => setFiltersOpen((o) => !o)}
            style={{
              padding: "12px 14px",
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontWeight: 900,
            }}
          >
            <span>Statusy</span>
            <span style={{ fontSize: 12, color: MUTED }}>
              {filteredPoints.length + filteredTunnels.length}/{points.length + tunnels.length}{" "}
              {filtersOpen ? "▾" : "▸"}
            </span>
          </div>

          {filtersOpen ? (
            <div style={{ padding: "8px 12px 12px", display: "grid", gap: 10 }}>
              {STATUSES.map((s) => (
                <label
                  key={s.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    opacity: visibleStatus[s.key] ? 1 : 0.5,
                    userSelect: "none",
                  }}
                >
                  <input type="checkbox" checked={visibleStatus[s.key]} onChange={() => toggleStatus(s.key)} />
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: s.color }} />
                  <span style={{ flex: 1, fontWeight: 800 }}>{s.label}</span>
                  <span style={{ fontSize: 12, color: MUTED }}>{counts[s.key] ?? 0}</span>
                </label>
              ))}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 2 }}>
                <button onClick={showAllStatuses} style={miniBtnStyle}>
                  Pokaż
                </button>
                <button onClick={hideAllStatuses} style={{ ...miniBtnStyle, background: "rgba(255,255,255,0.05)" }}>
                  Ukryj
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <MapContainer
          bounds={POLAND_BOUNDS}
          boundsOptions={{ padding: [20, 20] }}
          style={{ width: "100%", height: "100%" }}
          zoomControl={false}
        >
          <ZoomControl position="bottomright" />
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {worldMask ? (
            <GeoJSON
              data={worldMask}
              style={{
                fillColor: "#0f172a",
                fillOpacity: 0.55,
                color: "#0f172a",
                weight: 0,
              }}
            />
          ) : null}

          {/* Punkty: klik działa tylko w trybie "point" */}
          <ClickHandler enabled={addMode === "point"} onAdd={addPoint} />

          {/* Tunel: draw + edit/delete */}
          <FeatureGroup ref={drawGroupRef}>
            {EditControl ? (
              <EditControl
                position="bottomright"
                onCreated={onDrawCreated}
                onEdited={onDrawEdited}
                onDeleted={onDrawDeleted}
                draw={
                  addMode === "tunnel"
                    ? {
                        polyline: {
                          shapeOptions: { color: "#60a5fa", weight: 10, opacity: 0.9 },
                        },
                        polygon: false,
                        rectangle: false,
                        circle: false,
                        circlemarker: false,
                        marker: false,
                      }
                    : false
                }
                edit={{
                  edit: true,
                  remove: true,
                }}
              />
            ) : null}

            {/* Existing tunnels inside FeatureGroup so edit/delete works */}
            {filteredTunnels.map((t) => (
              <Polyline
                key={`tl-${t.id}`}
                positions={(t.path || []).map((p) => [p.lat, p.lng])}
                pathOptions={{
                  color: tunnelColor(t.status),
                  weight: 10,
                  opacity: 0.95,
                  lineCap: "round",
                  lineJoin: "round",
                  tunnelId: t.id,
                }}
                eventHandlers={{
                  click: (e) => {
                    setSelectedTunnelId(t.id);
                    setSelectedPointId(null);
                    setSidebarOpen(true);
                    try {
                      e?.target?.openPopup?.();
                    } catch {}
                  },
                }}
              >
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 900, marginBottom: 4 }}>
                      {t.name || `Tunel #${t.id}`}
                    </div>

                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
                      Status: <b>{statusLabel(t.status)}</b> • Węzłów:{" "}
                      <b>{Array.isArray(t.path) ? t.path.length : 0}</b>
                    </div>

                    {t.director ? (
                      <div style={{ marginTop: 6 }}>
                        <b>Dyrektor:</b> {t.director}
                      </div>
                    ) : null}

                    {t.winner ? (
                      <div style={{ marginTop: 6 }}>
                        <b>Firma:</b> {t.winner}
                      </div>
                    ) : null}

                    <div style={{ marginTop: 8 }}>
                      {t.note ? t.note : <span style={{ opacity: 0.75 }}>Brak notatki</span>}
                    </div>
                  </div>
                </Popup>
              </Polyline>
            ))}
          </FeatureGroup>

          {/* Points markers */}
          {filteredPoints.map((pt) => {
            const st = pt.status || "planowany";
            const icon = pinIcons[st] || pinIcons.planowany;

            return (
              <Marker
                key={pt.id}
                position={[pt.lat, pt.lng]}
                icon={icon}
                eventHandlers={{
                  click: () => {
                    setSelectedPointId(pt.id);
                    setSelectedTunnelId(null);
                    setSidebarOpen(true);
                  },
                }}
              >
                <Popup>
                  <b>{pt.title}</b>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>{statusLabel(pt.status)}</div>
                  {pt.director ? (
                    <div style={{ marginTop: 6 }}>
                      <b>Dyrektor:</b> {pt.director}
                    </div>
                  ) : null}
                  {pt.winner ? (
                    <div style={{ marginTop: 6 }}>
                      <b>Firma:</b> {pt.winner}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 6 }}>{pt.note || "Brak notatki"}</div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </main>
    </div>
  );
}

/** ===== small styles ===== */

const fieldStyle = {
  padding: 10,
  borderRadius: 12,
  border: `1px solid ${BORDER}`,
  background: "rgba(255,255,255,0.06)",
  color: TEXT_LIGHT,
  outline: "none",
};

const btnStyle = (disabled) => ({
  padding: 10,
  borderRadius: 12,
  border: `1px solid ${BORDER}`,
  background: disabled ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.08)",
  color: TEXT_LIGHT,
  cursor: disabled ? "default" : "pointer",
  fontWeight: 800,
});

const dangerBtnStyle = (disabled) => ({
  padding: 10,
  borderRadius: 12,
  border: "1px solid rgba(255,80,80,0.55)",
  background: disabled ? "rgba(255,80,80,0.18)" : "rgba(255,80,80,0.12)",
  color: TEXT_LIGHT,
  cursor: disabled ? "default" : "pointer",
  fontWeight: 800,
});

const emptyBoxStyle = {
  padding: 12,
  borderRadius: 14,
  border: `1px dashed ${BORDER}`,
  color: MUTED,
};

const pillStyle = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.10)",
  border: `1px solid ${BORDER}`,
  color: "rgba(255,255,255,0.9)",
  whiteSpace: "nowrap",
};

const miniBtnStyle = {
  padding: "10px 10px",
  borderRadius: 12,
  border: `1px solid ${BORDER}`,
  background: "rgba(255,255,255,0.08)",
  color: TEXT_LIGHT,
  cursor: "pointer",
  fontWeight: 800,
};

/** ===== Login styles ===== */

const pageStyle = {
  position: "fixed",
  inset: 0,
  minHeight: "100vh",
  width: "100%",
  display: "grid",
  placeItems: "center",
  padding: "clamp(12px, 3vw, 24px)",
  overflow: "hidden",
  overflowX: "hidden",
  background:
    "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.22), transparent 60%)," +
    "radial-gradient(900px 500px at 85% 20%, rgba(34,197,94,0.14), transparent 55%)," +
    "radial-gradient(900px 500px at 40% 95%, rgba(59,130,246,0.16), transparent 55%)," +
    "linear-gradient(180deg, #070B14 0%, #0B1220 45%, #070B14 100%)",
};

const cardStyle = {
  boxSizing: "border-box",
  width: "min(420px, calc(100% - 32px))",
  maxWidth: 520,
  background: "rgba(18, 32, 51, 0.72)",
  borderRadius: 18,
  padding: "clamp(16px, 2.2vw, 22px)",
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
  width: 10,
  height: 10,
  borderRadius: 999,
  background: "rgba(255,255,255,0.85)",
  boxShadow: "0 0 0 6px rgba(255,255,255,0.08)",
  flex: "0 0 auto",
};

const brandText = {
  color: "white",
  fontWeight: 800,
  letterSpacing: 0.2,
  fontSize: 14,
};

const titleStyle = {
  margin: "10px 0 0",
  fontSize: 22,
  color: "white",
  textAlign: "center",
};

const subtitleStyle = {
  marginTop: 8,
  opacity: 0.82,
  color: "white",
  textAlign: "center",
};

const labelStyle = {
  display: "block",
  color: "rgba(255,255,255,0.85)",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
};

const inputStyle = {
  boxSizing: "border-box",
  width: "100%",
  height: 40,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  padding: "0 12px",
  outline: "none",
};

const errorStyle = {
  boxSizing: "border-box",
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  background: "rgba(255, 59, 59, 0.16)",
  border: "1px solid rgba(255, 59, 59, 0.40)",
  color: "rgba(255,255,255,0.96)",
};

const primaryButtonStyle = (loading) => ({
  boxSizing: "border-box",
  marginTop: 14,
  width: "100%",
  height: 40,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.10)",
  color: "white",
  fontWeight: 800,
  cursor: loading ? "not-allowed" : "pointer",
});

const hintStyle = {
  marginTop: 12,
  opacity: 0.78,
  fontSize: 13,
  color: "white",
  textAlign: "center",
};
