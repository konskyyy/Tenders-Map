import { MapContainer, TileLayer, Marker, Popup, useMapEvents, ZoomControl } from "react-leaflet";
import { useEffect, useMemo, useState } from "react";
import L from "leaflet";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:3001";
const API = `${API_BASE}/api`;

// RAL 5003
const RAL5003 = "#1F3855";
const RAL5003_DARK = "#162A40";
const TEXT_LIGHT = "#ffffff";
const BORDER = "rgba(255,255,255,0.12)";
const MUTED = "rgba(255,255,255,0.75)";

// Granice Polski
const POLAND_BOUNDS = [
  [49.0, 14.1],
  [54.9, 24.2],
];

const STATUSES = [
  { key: "planowany", label: "Planowany", color: "#3b82f6" },
  { key: "przetarg", label: "Przetarg", color: "#f59e0b" },
  { key: "realizacja", label: "Realizacja", color: "#22c55e" },
];

function ClickHandler({ onAdd }) {
  useMapEvents({
    click(e) {
      onAdd(e.latlng);
    },
  });
  return null;
}

function statusLabel(s) {
  if (s === "przetarg") return "przetarg";
  if (s === "realizacja") return "realizacja";
  return "planowany";
}

function statusColor(status) {
  if (status === "przetarg") return "#f59e0b"; // pomarańcz
  if (status === "realizacja") return "#22c55e"; // zielony
  return "#3b82f6"; // niebieski
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
        {value?.trim() ? value : <span style={{ color: "rgba(255,255,255,0.6)" }}>{placeholder}</span>}
      </div>
    </div>
  );
}

export default function App() {
  const [points, setPoints] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ✅ filtry statusów
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [visibleStatus, setVisibleStatus] = useState({
    planowany: true,
    przetarg: true,
    realizacja: true,
  });

  const selected = useMemo(
    () => points.find((p) => p.id === selectedId) || null,
    [points, selectedId]
  );

  const [form, setForm] = useState({
    title: "",
    director: "",
    winner: "",
    note: "",
    status: "planowany",
  });

  const [saving, setSaving] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const pinIcons = useMemo(() => {
    return {
      planowany: makePinIcon(statusColor("planowany")),
      przetarg: makePinIcon(statusColor("przetarg")),
      realizacja: makePinIcon(statusColor("realizacja")),
    };
  }, []);

  // ✅ punkty po filtrach (dla mapy i listy)
  const filteredPoints = useMemo(() => {
    return points.filter((p) => visibleStatus[p.status || "planowany"] !== false);
  }, [points, visibleStatus]);

  // ✅ liczniki (po wszystkich punktach)
  const counts = useMemo(() => {
    const c = { planowany: 0, przetarg: 0, realizacja: 0 };
    for (const p of points) {
      const st = p.status || "planowany";
      if (c[st] === undefined) c[st] = 0;
      c[st] += 1;
    }
    return c;
  }, [points]);

  // ✅ jeżeli zaznaczony punkt został odfiltrowany, odznacz
  useEffect(() => {
    if (!selectedId) return;
    const stillVisible = filteredPoints.some((p) => p.id === selectedId);
    if (!stillVisible) setSelectedId(null);
  }, [filteredPoints, selectedId]);

  async function loadPoints() {
    setLoading(true);
    setApiError("");
    try {
      const res = await fetch(`${API}/points`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPoints(data);
    } catch (e) {
      setApiError(`Nie mogę pobrać punktów: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPoints();
  }, []);

  useEffect(() => {
    if (!selected) return;
    setForm({
      title: selected.title || "",
      director: selected.director || "",
      winner: selected.winner || "",
      note: selected.note || "",
      status: selected.status || "planowany",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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
      const res = await fetch(`${API}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      setPoints((p) => [created, ...p]);
      setSelectedId(created.id);
      setSidebarOpen(true);
    } catch (e) {
      setApiError(`Nie mogę dodać punktu: ${String(e)}`);
    }
  }

  async function savePoint() {
    if (!selected) return;

    setSaving(true);
    setApiError("");
    try {
      const res = await fetch(`${API}/points/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await res.json();
      setPoints((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      setApiError(`Nie mogę zapisać: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function deletePoint() {
    if (!selected) return;

    const ok = window.confirm(`Usunąć punkt #${selected.id}?`);
    if (!ok) return;

    setBusyDelete(true);
    setApiError("");
    try {
      const res = await fetch(`${API}/points/${selected.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPoints((prev) => prev.filter((p) => p.id !== selected.id));
      setSelectedId(null);
    } catch (e) {
      setApiError(`Nie mogę usunąć: ${String(e)}`);
    } finally {
      setBusyDelete(false);
    }
  }

  function toggleStatus(key) {
    setVisibleStatus((s) => ({ ...s, [key]: !s[key] }));
  }

  function showAllStatuses() {
    setVisibleStatus({ planowany: true, przetarg: true, realizacja: true });
  }

  function hideAllStatuses() {
    setVisibleStatus({ planowany: false, przetarg: false, realizacja: false });
  }

  const sidebarWidthOpen = 380;
  const sidebarWidthClosed = 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${sidebarOpen ? sidebarWidthOpen : sidebarWidthClosed}px 1fr`,
        width: "100vw",
        height: "100vh",
      }}
    >
      {/* SIDEBAR */}
      <aside
        style={{
          background: RAL5003,
          color: TEXT_LIGHT,
          borderRight: sidebarOpen ? `1px solid ${BORDER}` : "none",
          overflow: "hidden",
          width: sidebarOpen ? sidebarWidthOpen : sidebarWidthClosed,
          transition: "width 200ms ease",
        }}
      >
        {sidebarOpen ? (
          <>
            {/* HEADER */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 12px",
                borderBottom: `1px solid ${BORDER}`,
                background: RAL5003_DARK,
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

              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 800, letterSpacing: 0.2 }}>Punkty postępu</div>
                <div style={{ fontSize: 12, color: MUTED }}>Kliknij mapę, aby dodać punkt.</div>
              </div>
            </div>

            {/* CONTENT */}
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

              <button
                onClick={loadPoints}
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 12,
                  border: `1px solid ${BORDER}`,
                  background: "rgba(255,255,255,0.08)",
                  color: TEXT_LIGHT,
                  cursor: "pointer",
                  fontWeight: 700,
                  marginBottom: 12,
                }}
              >
                {loading ? "Ładuję..." : "Odśwież punkty"}
              </button>

              {/* BOXy info */}
              <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
                <InfoCard label="Dyrektor kontraktu" value={selected?.director} placeholder="(nie ustawiono)" />
                <InfoCard label="Firma (wykonawca)" value={selected?.winner} placeholder="(nie ustawiono)" />
              </div>

              {/* EDYCJA */}
              <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                {selected ? (
                  <>
                    <div style={{ fontSize: 12, color: MUTED }}>Edycja punktu #{selected.id}</div>

                    <label style={{ fontSize: 12, color: MUTED }}>Tytuł</label>
                    <input
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        background: "rgba(255,255,255,0.06)",
                        color: TEXT_LIGHT,
                        outline: "none",
                      }}
                    />

                    <label style={{ fontSize: 12, color: MUTED }}>Dyrektor kontraktu</label>
                    <input
                      value={form.director}
                      onChange={(e) => setForm((f) => ({ ...f, director: e.target.value }))}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        background: "rgba(255,255,255,0.06)",
                        color: TEXT_LIGHT,
                        outline: "none",
                      }}
                    />

                    <label style={{ fontSize: 12, color: MUTED }}>Firma (wykonawca)</label>
                    <input
                      value={form.winner}
                      onChange={(e) => setForm((f) => ({ ...f, winner: e.target.value }))}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        background: "rgba(255,255,255,0.06)",
                        color: TEXT_LIGHT,
                        outline: "none",
                      }}
                    />

                    <label style={{ fontSize: 12, color: MUTED }}>Notatka</label>
                    <textarea
                      rows={6}
                      value={form.note}
                      onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
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

                    <label style={{ fontSize: 12, color: MUTED }}>Status</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        background: "rgba(255,255,255,0.06)",
                        color: TEXT_LIGHT,
                        outline: "none",
                      }}
                    >
                      <option value="planowany">planowany</option>
                      <option value="przetarg">przetarg</option>
                      <option value="realizacja">realizacja</option>
                    </select>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                      <button
                        onClick={savePoint}
                        disabled={saving}
                        style={{
                          padding: 10,
                          borderRadius: 12,
                          border: `1px solid ${BORDER}`,
                          background: saving ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.08)",
                          color: TEXT_LIGHT,
                          cursor: saving ? "default" : "pointer",
                          fontWeight: 700,
                        }}
                      >
                        {saving ? "Zapisuję..." : "Zapisz"}
                      </button>

                      <button
                        onClick={deletePoint}
                        disabled={busyDelete}
                        style={{
                          padding: 10,
                          borderRadius: 12,
                          border: "1px solid rgba(255,80,80,0.55)",
                          background: busyDelete ? "rgba(255,80,80,0.18)" : "rgba(255,80,80,0.12)",
                          color: TEXT_LIGHT,
                          cursor: busyDelete ? "default" : "pointer",
                          fontWeight: 700,
                        }}
                      >
                        {busyDelete ? "Usuwam..." : "Usuń"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      border: `1px dashed ${BORDER}`,
                      color: MUTED,
                    }}
                  >
                    Wybierz punkt (kliknij marker lub pozycję na liście).
                  </div>
                )}
              </div>

              <div style={{ height: 1, background: BORDER, margin: "10px 0" }} />

              {/* LISTA — ✅ filtrowana */}
              <div style={{ display: "grid", gap: 8 }}>
                {filteredPoints.map((pt) => (
                  <div
                    key={pt.id}
                    onClick={() => {
                      setSelectedId(pt.id);
                      setSidebarOpen(true);
                    }}
                    style={{
                      padding: 10,
                      borderRadius: 14,
                      border:
                        pt.id === selectedId ? `2px solid rgba(255,255,255,0.35)` : `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.05)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 800, display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span>{pt.title}</span>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "rgba(255,255,255,0.10)",
                          border: `1px solid ${BORDER}`,
                          color: "rgba(255,255,255,0.9)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {statusLabel(pt.status)}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                      ({Number(pt.lat).toFixed(4)}, {Number(pt.lng).toFixed(4)})
                    </div>

                    {pt.winner ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.9)" }}>
                        <b>Firma:</b> {pt.winner}
                      </div>
                    ) : null}
                    {pt.director ? (
                      <div style={{ marginTop: 4, fontSize: 12, color: "rgba(255,255,255,0.9)" }}>
                        <b>Dyrektor:</b> {pt.director}
                      </div>
                    ) : null}

                    {pt.note ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.9)" }}>
                        {pt.note.length > 90 ? pt.note.slice(0, 90) + "…" : pt.note}
                      </div>
                    ) : null}
                  </div>
                ))}

                {filteredPoints.length === 0 ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      border: `1px dashed ${BORDER}`,
                      color: MUTED,
                    }}
                  >
                    Brak punktów dla zaznaczonych statusów.
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </aside>

      {/* MAP */}
      <main style={{ width: "100%", height: "100%", position: "relative" }}>
        {!sidebarOpen ? (
          <button
            onClick={() => setSidebarOpen(true)}
            title="Pokaż panel"
            style={{
              position: "absolute",
              zIndex: 1000,
              top: 12,
              left: 12,
              height: 44,
              padding: "0 12px",
              borderRadius: 14,
              border: `1px solid ${BORDER}`,
              background: RAL5003_DARK,
              color: TEXT_LIGHT,
              cursor: "pointer",
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              gap: 10,
              boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>⟩</span>
            <span style={{ fontSize: 13 }}>Panel</span>
          </button>
        ) : null}

        {/* ✅ Filtry statusów — prawy górny róg */}
        <div
          style={{
            position: "absolute",
            zIndex: 1200,
            top: 12,
            right: 12,
            width: 240,
            borderRadius: 16,
            border: `1px solid ${BORDER}`,
            background: "rgba(22,42,64,0.70)", // półprzezroczysty
            backdropFilter: "blur(8px)",
            color: TEXT_LIGHT,
            overflow: "hidden",
            boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
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
              {filteredPoints.length}/{points.length} {filtersOpen ? "▾" : "▸"}
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
                <button
                  onClick={showAllStatuses}
                  style={{
                    padding: "10px 10px",
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    background: "rgba(255,255,255,0.08)",
                    color: TEXT_LIGHT,
                    cursor: "pointer",
                    fontWeight: 800,
                  }}
                >
                  Pokaż
                </button>
                <button
                  onClick={hideAllStatuses}
                  style={{
                    padding: "10px 10px",
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    background: "rgba(255,255,255,0.05)",
                    color: TEXT_LIGHT,
                    cursor: "pointer",
                    fontWeight: 800,
                  }}
                >
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

          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          <ClickHandler onAdd={addPoint} />

          {/* ✅ MARKERY — filtrowane */}
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
                    setSelectedId(pt.id);
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
