// frontend/src/api.js

const DEFAULT_API = "https://tenders-map-api.onrender.com";

function resolveApiBase() {
  const envUrl =
    import.meta?.env?.VITE_API_URL ||
    import.meta?.env?.NEXT_PUBLIC_API_URL ||
    "";

  // Jeśli env jest puste albo względne (np. "/api"), ignorujemy i bierzemy DEFAULT_API
  if (!envUrl || envUrl.startsWith("/")) return DEFAULT_API;

  // Jeśli ktoś omyłkowo ustawił URL frontendu na Vercel, też ignorujemy
  try {
    const u = new URL(envUrl);
    if (u.hostname.endsWith("vercel.app")) return DEFAULT_API;
  } catch {
    return DEFAULT_API;
  }

  return envUrl.replace(/\/+$/, ""); // usuń trailing slash
}

export const API_BASE = resolveApiBase();

export function setToken(token) {
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

export function getToken() {
  return localStorage.getItem("token");
}

async function parseJsonOrThrow(res) {
  const text = await res.text();
  let data = {};
