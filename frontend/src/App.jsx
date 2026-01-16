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
  useMap,
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
function MapRefSetter({ onReady }) {
  const map = useMap();

  useEffect(() => {
    onReady?.(map);
  }, [map, onReady]);

  return null;
}
function formatDateTimePL(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function JournalPanel({
  visible,
  kind, // "points" | "tunnels"
  entity, // selectedPoint | selectedTunnel
  user,
  authFetch,
  API,
  BORDER,
  MUTED,
  TEXT_LIGHT,
  GLASS_BG,
  GLASS_SHADOW,
}) {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editingBody, setEditingBody] = useState("");
  const [busyActionId, setBusyActionId] = useState(null);

  const entityId = entity?.id ?? null;

  async function load() {
    if (!entityId) return;
    setLoading(true);
    setErr("");
    try {
      const res = await authFetch(`${API}/${kind}/${entityId}/comments`);
      const data = await readJsonOrThrow(res);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!visible) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, kind, entityId]);

  async function addComment() {
    if (!entityId) return;
    const body = String(draft || "").trim();
    if (!body) return;

    setBusyActionId("add");
    setErr("");
    try {
      const res = await authFetch(`${API}/${kind}/${entityId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const created = await readJsonOrThrow(res);
      setDraft("");
      setItems((prev) => [created, ...prev]);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusyActionId(null);
    }
  }

  async function saveEdit(commentId) {
    if (!entityId) return;
    const body = String(editingBody || "").trim();
    if (!body) return;

    setBusyActionId(commentId);
    setErr("");
    try {
      const res = await authFetch(`${API}/${kind}/${entityId}/comments/${commentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const updated = await readJsonOrThrow(res);

      setItems((prev) => prev.map((x) => (String(x.id) === String(updated.id) ? updated : x)));
      setEditingId(null);
      setEditingBody("");
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusyActionId(null);
    }
  }

  async function removeComment(commentId) {
    if (!entityId) return;
    const ok = window.confirm("Usunąć ten wpis z dziennika?");
    if (!ok) return;

    setBusyActionId(commentId);
    setErr("");
    try {
      const res = await authFetch(`${API}/${kind}/${entityId}/comments/${commentId}`, {
        method: "DELETE",
      });
      await readJsonOrThrow(res);

      setItems((prev) => prev.filter((x) => String(x.id) !== String(commentId)));
      if (String(editingId) === String(commentId)) {
        setEditingId(null);
        setEditingBody("");
      }
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusyActionId(null);
    }
  }

  if (!visible) return null;

  const title =
    kind === "points"
      ? `Dziennik: ${entity?.title || `#${entityId}`}`
      : `Dziennik: ${entity?.name || `#${entityId}`}`;

  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${BORDER}`,
        background: GLASS_BG,
        color: TEXT_LIGHT,
        overflow: "hidden",
        boxShadow: GLASS_SHADOW,
      }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "12px 14px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontWeight: 900,
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 12, color: MUTED }}>
          {loading ? "Ładuję..." : `${items.length} wpis(y)`} {open ? "▾" : "▸"}
        </span>
      </div>

      {open ? (
        <div style={{ padding: "10px 12px 12px", display: "grid", gap: 10 }}>
          {err ? (
            <div
              style={{
                padding: 10,
                borderRadius: 14,
                border: "1px solid rgba(255,120,120,0.45)",
                background: "rgba(255,120,120,0.12)",
                color: "rgba(255,255,255,0.95)",
                fontSize: 12,
              }}
            >
              {err}
            </div>
          ) : null}

          {/* Dodawanie wpisu */}
          <div style={{ display: "grid", gap: 8 }}>
            <textarea
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Dodaj wpis do dziennika…"
              style={{
                padding: 10,
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.06)",
                color: TEXT_LIGHT,
                outline: "none",
                resize: "vertical",
              }}
            />
            <button
              onClick={addComment}
              disabled={busyActionId === "add" || !draft.trim()}
              style={{
                padding: 10,
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.10)",
                color: TEXT_LIGHT,
                cursor: busyActionId === "add" ? "default" : "pointer",
                fontWeight: 900,
              }}
            >
              {busyActionId === "add" ? "Dodaję..." : "Dodaj wpis"}
            </button>
          </div>

          <div style={{ height: 1, background: BORDER, opacity: 0.9 }} />

          {/* Lista */}
          {items.length === 0 ? (
            <div style={{ fontSize: 12, color: MUTED }}>Brak wpisów dla tego projektu.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {items.map((c) => {
                const isMine = String(c.user_id) === String(user?.id);
                const isEditing = String(editingId) === String(c.id);

                return (
                  <div
                    key={c.id}
                    style={{
                      borderRadius: 14,
                      border: `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.05)",
                      padding: 10,
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontSize: 12, color: MUTED }}>
                        <b style={{ color: "rgba(255,255,255,0.92)" }}>{c.user_email || "użytkownik"}</b>{" "}
                        • {formatDateTimePL(c.created_at)}
                        {c.edited ? (
                          <span style={{ marginLeft: 6, opacity: 0.8 }}>(edytowano)</span>
                        ) : null}
                      </div>

                      {isMine ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          {!isEditing ? (
                            <button
                              onClick={() => {
                                setEditingId(c.id);
                                setEditingBody(c.body || "");
                              }}
                              style={{
                                padding: "6px 10px",
                                borderRadius: 12,
                                border: `1px solid ${BORDER}`,
                                background: "rgba(255,255,255,0.08)",
                                color: TEXT_LIGHT,
                                cursor: "pointer",
                                fontWeight: 900,
                                fontSize: 12,
                              }}
                            >
                              Edytuj
                            </button>
                          ) : null}

                          <button
                            onClick={() => removeComment(c.id)}
                            disabled={busyActionId === c.id}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 12,
                              border: "1px solid rgba(255,80,80,0.55)",
                              background: "rgba(255,80,80,0.12)",
                              color: TEXT_LIGHT,
                              cursor: busyActionId === c.id ? "default" : "pointer",
                              fontWeight: 900,
                              fontSize: 12,
                            }}
                          >
                            {busyActionId === c.id ? "..." : "Usuń"}
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {!isEditing ? (
                      <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
                    ) : (
                      <div style={{ display: "grid", gap: 8 }}>
                        <textarea
                          rows={3}
                          value={editingBody}
                          onChange={(e) => setEditingBody(e.target.value)}
                          style={{
                            padding: 10,
                            borderRadius: 12,
                            border: `1px solid ${BORDER}`,
                            background: "rgba(255,255,255,0.06)",
                            color: TEXT_LIGHT,
                            outline: "none",
                            resize: "vertical",
                          }}
                        />

                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => saveEdit(c.id)}
                            disabled={busyActionId === c.id || !editingBody.trim()}
                            style={{
                              flex: 1,
                              padding: 10,
                              borderRadius: 12,
                              border: `1px solid ${BORDER}`,
                              background: "rgba(255,255,255,0.10)",
                              color: TEXT_LIGHT,
                              cursor: busyActionId === c.id ? "default" : "pointer",
                              fontWeight: 900,
                            }}
                          >
                            {busyActionId === c.id ? "Zapisuję..." : "Zapisz"}
                          </button>

                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditingBody("");
                            }}
                            style={{
                              flex: 1,
                              padding: 10,
                              borderRadius: 12,
                              border: `1px solid ${BORDER}`,
                              background: "rgba(255,255,255,0.05)",
                              color: TEXT_LIGHT,
                              cursor: "pointer",
                              fontWeight: 900,
                            }}
                          >
                            Anuluj
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: 10,
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              background: "rgba(255,255,255,0.06)",
              color: TEXT_LIGHT,
              cursor: loading ? "default" : "pointer",
              fontWeight: 900,
              fontSize: 12,
            }}
          >
            {loading ? "Odświeżam..." : "Odśwież dziennik"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  /** ===== Leaflet Draw FIX (L is not defined) ===== */
  const [DrawEditControl, setDrawEditControl] = useState(null);

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

        setDrawEditControl(() => mod.EditControl);
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

  const [loadingTunnels, setLoadingTunnels] = useState(false);

  const drawGroupRef = useRef(null);

  /** ===== Map + refs (zoom/popup) ===== */
  const mapRef = useRef(null);
  const markerRefs = useRef({});
  const tunnelRefs = useRef({});

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

  function focusPoint(pt) {
    const map = mapRef.current;
    if (!map || !pt) return;

    const lat = Number(pt.lat);
    const lng = Number(pt.lng);

    map.flyTo([lat, lng], Math.max(map.getZoom(), 12), {
      animate: true,
      duration: 0.6,
    });

    setTimeout(() => {
      const m = markerRefs.current[pt.id];
      try {
        m?.openPopup?.();
      } catch {}
    }, 250);
  }

  function focusTunnel(t) {
    const map = mapRef.current;
    if (!map || !t) return;

    const latlngs = (t.path || []).map((p) => [Number(p.lat), Number(p.lng)]);
    if (latlngs.length === 0) return;

    try {
      const bounds = L.latLngBounds(latlngs);
      map.fitBounds(bounds, { padding: [40, 40], animate: true, duration: 0.6 });
    } catch {}

    setTimeout(() => {
      const pl = tunnelRefs.current[t.id];
      try {
        pl?.openPopup?.();
      } catch {}
    }, 250);
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

  /** ===== Points CRUD (dodawanie tylko) ===== */
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

      // nie otwieramy panelu edycji (zgodnie z wymaganiem)
      // setSidebarOpen(true);
      focusPoint(data);
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę dodać punktu: ${String(e)}`);
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

      // nie otwieramy panelu edycji (zgodnie z wymaganiem)
      // setSidebarOpen(true);
      focusTunnel(data);
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

              {/* Dodawanie */}
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

              <div style={{ height: 1, background: BORDER, margin: "10px 0" }} />

              {/* LISTA */}
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Lista projektów</div>

              <div style={{ display: "grid", gap: 8 }}>
                {filteredTunnels.map((t) => (
                  <div
                    key={`t-${t.id}`}
                    onClick={() => {
                      setSelectedTunnelId(t.id);
                      setSelectedPointId(null);
                      focusTunnel(t);
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
                  </div>
                ))}

                {filteredPoints.map((pt) => (
                  <div
                    key={`p-${pt.id}`}
                    onClick={() => {
                      setSelectedPointId(pt.id);
                      setSelectedTunnelId(null);
                      focusPoint(pt);
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

        {/* PRAWA STRONA: Statusy + Dziennik */}
        <div
          style={{
            position: "absolute",
            zIndex: 1600,
            top: 12,
            right: 12,
            width: 360,
            display: "grid",
            gap: 10,
          }}
        >
          {/* STATUSY */}
          <div
            style={{
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
                    <input
                      type="checkbox"
                      checked={visibleStatus[s.key]}
                      onChange={() => toggleStatus(s.key)}
                    />
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: s.color }} />
                    <span style={{ flex: 1, fontWeight: 800 }}>{s.label}</span>
                    <span style={{ fontSize: 12, color: MUTED }}>{counts[s.key] ?? 0}</span>
                  </label>
                ))}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 2 }}>
                  <button onClick={showAllStatuses} style={miniBtnStyle}>
                    Pokaż
                  </button>
                  <button
                    onClick={hideAllStatuses}
                    style={{ ...miniBtnStyle, background: "rgba(255,255,255,0.05)" }}
                  >
                    Ukryj
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* DZIENNIK (POKAZUJE SIĘ TYLKO GDY WYBRANY PROJEKT) */}
          <JournalPanel
            visible={!!selectedPoint || !!selectedTunnel}
            kind={selectedPoint ? "points" : "tunnels"}
            entity={selectedPoint || selectedTunnel}
            user={user}
            authFetch={authFetch}
            API={API}
            BORDER={BORDER}
            MUTED={MUTED}
            TEXT_LIGHT={TEXT_LIGHT}
            GLASS_BG={GLASS_BG}
            GLASS_SHADOW={GLASS_SHADOW}
          />
        </div>

        <MapContainer
          bounds={POLAND_BOUNDS}
          boundsOptions={{ padding: [20, 20] }}
          style={{ width: "100%", height: "100%" }}
          zoomControl={false}
        >
          <MapRefSetter
            onReady={(map) => {
              mapRef.current = map;
            }}
          />
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
            {DrawEditControl ? (
              <DrawEditControl
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
                  edit: {},
                  remove: {},
                }}
              />
            ) : null}

            {/* Existing tunnels inside FeatureGroup so edit/delete works */}
            {filteredTunnels.map((t) => (
              <Polyline
                ref={(ref) => {
                  if (ref) tunnelRefs.current[t.id] = ref;
                }}
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
                      Status: <b>{statusLabel(t.status)}</b>
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
                ref={(ref) => {
                  if (ref) markerRefs.current[pt.id] = ref;
                }}
                key={pt.id}
                position={[pt.lat, pt.lng]}
                icon={icon}
                eventHandlers={{
                  click: () => {
                    setSelectedPointId(pt.id);
                    setSelectedTunnelId(null);
                    try {
                      markerRefs.current[pt.id]?.openPopup?.();
                    } catch {}
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
