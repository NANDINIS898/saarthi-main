import axios, { AxiosError } from "axios";

/**
 * Single shared axios instance. We use a relative baseURL because vite.config.ts
 * proxies /auth, /users, /kyc, /health → http://127.0.0.1:8000 in development.
 */
export const api = axios.create({
  baseURL: "/",
  headers: { "Content-Type": "application/json" },
});

// Attach the bearer token (if any) to every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("saarthi_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 401 → drop the token so the user is forced back to login.
api.interceptors.response.use(
  (resp) => resp,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("saarthi_token");
    }
    return Promise.reject(err);
  }
);

/** Extract the {detail: string} message FastAPI returns on errors. */
export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { detail?: unknown } | undefined;
    if (data?.detail) {
      if (typeof data.detail === "string") return data.detail;
      // Pydantic validation errors are arrays of {msg, loc, type}
      if (Array.isArray(data.detail)) {
        return data.detail.map((d) => (typeof d === "object" && d && "msg" in d ? (d as { msg: string }).msg : String(d))).join("; ");
      }
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Unknown error";
}
