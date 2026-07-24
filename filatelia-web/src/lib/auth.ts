const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role?: string;
}

export async function login(email: string, password: string): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.success) {
      if (typeof window !== "undefined") {
        localStorage.setItem("fp_user", JSON.stringify(data.user));
        localStorage.setItem("fp_token", data.token || "");
      }
    }
    return data;
  } catch {
    return { success: false, error: "Error de conexión" };
  }
}

export async function register(name: string, email: string, password: string): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (data.success && typeof window !== "undefined") {
      localStorage.setItem("fp_user", JSON.stringify(data.user));
      localStorage.setItem("fp_token", data.token || "");
    }
    return data;
  } catch {
    return { success: false, error: "Error de conexión" };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" });
  } catch {}
  if (typeof window !== "undefined") {
    localStorage.removeItem("fp_user");
    localStorage.removeItem("fp_token");
  }
}

export async function getMe(): Promise<AuthUser | null> {
  try {
    const token = typeof window !== "undefined" ? localStorage.getItem("fp_token") : null;
    const res = await fetch(`${API}/auth/me`, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    return data.success ? data.user : null;
  } catch {
    return null;
  }
}

export function getCachedUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("fp_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
