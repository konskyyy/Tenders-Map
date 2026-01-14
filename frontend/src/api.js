// frontend/src/api.js
const DEFAULT_API = "https://tenders-map-api.onrender.com";

const envUrl =
  (import.meta && import.meta.env && import.meta.env.VITE_API_URL) || "";

export const API_BASE = (envUrl.startsWith("http") ? envUrl : DEFAULT_API).replace(
  /\/+$/,
  ""
);

export function setToken(token) {
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

export function getToken() {
  return localStorage.getItem("token");
}

async function json(res) {
  const t = await res.text();
  let data = {};
  try {
    data = t ? JSON.parse(t) : {};
  } catch {
    throw new Error("Serwer zwrócił niepoprawną odpowiedź.");
  }
  if (!res.ok) throw new Error(data.error || "Błąd żądania.");
  return data;
}

export async function loginRequest(login, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: login, login, password }),
  });
  return json(res);
}

export async function meRequest() {
  const token = getToken();
  if (!token) throw new Error("Brak tokenu");
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return json(res);
}