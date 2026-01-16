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

  if (type === "Polygon") return coordinates?.[0] ? [coordinates[0]] : [];
  if (type === "MultiPolygon") {
    const rings = [];
    for (const poly of coordinates || []) if (poly?.[0]) rings.push(poly[0]);
    return rings;
  }
  return [];
}

async function readJsonOrThrow(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`API nie zwróciło JSON (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function toPath(latlngs) {
  return (latlngs || []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
}

export default function App() {
  /** ===== FIX leaflet-draw ===== */
  const [EditControlComp, setEditControlComp] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      window.L = L;
      await import("leaflet-draw");
      const mod = await import("react-leaflet-draw");
      if (alive) setEditControlComp(() => mod.EditControl);
    })();
    return () => (alive = false);
  }, []);

  /** ===== AUTH ===== */
  const [mode, setMode] = useState("checking");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const token = getToken();
        if (!token) return setMode("login");
        const me = await meRequest();
        setUser(me.user);
        setMode("app");
      } catch {
        setToken(null);
        setMode("login");
      }
    })();
  }, []);

  async function onLoginSubmit(e) {
    e.preventDefault();
    setLoadingAuth(true);
    try {
      const data = await loginRequest(login, password);
      setToken(data.token);
      setUser(data.user);
      setMode("app");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoadingAuth(false);
    }
  }

  if (mode === "login") {
    return (
      <div style={{ color: "white", padding: 40 }}>
        <form onSubmit={onLoginSubmit}>
          <input value={login} onChange={(e) => setLogin(e.target.value)} />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button>Zaloguj</button>
          {err}
        </form>
      </div>
    );
  }

  return (
    <MapContainer
      bounds={POLAND_BOUNDS}
      style={{ width: "100vw", height: "100vh" }}
      zoomControl={false}
    >
      <ZoomControl position="bottomright" />
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      <FeatureGroup>
        {EditControlComp ? (
          <EditControlComp
            position="bottomright"
            draw={{ polyline: true, polygon: false, marker: false }}
          />
        ) : null}
      </FeatureGroup>
    </MapContainer>
  );
}
