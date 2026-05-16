import { create } from "zustand";
import { api } from "../api/client";
import type { TokenResponse, User } from "../api/types";

const TOKEN_KEY = "saarthi_token";

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  // actions
  init: () => Promise<void>;
  signup: (payload: SignupPayload) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

export interface SignupPayload {
  full_name: string;
  email: string;
  phone?: string;
  password: string;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem(TOKEN_KEY),
  loading: false,

  /** Called once on app mount: if a token exists, fetch the current user. */
  init: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    set({ loading: true });
    try {
      const { data } = await api.get<User>("/auth/me");
      set({ user: data, token });
    } catch {
      // 401 interceptor already cleared the token
      set({ user: null, token: null });
    } finally {
      set({ loading: false });
    }
  },

  signup: async (payload) => {
    set({ loading: true });
    try {
      await api.post<User>("/auth/signup", payload);
      // After signup, sign the user in so they have a token immediately.
      await get().login(payload.email, payload.password);
    } finally {
      set({ loading: false });
    }
  },

  login: async (email, password) => {
    set({ loading: true });
    try {
      const { data } = await api.post<TokenResponse>("/auth/login", { email, password });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      set({ token: data.access_token });
      await get().refreshUser();
    } finally {
      set({ loading: false });
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ user: null, token: null });
  },

  refreshUser: async () => {
    const { data } = await api.get<User>("/auth/me");
    set({ user: data });
  },
}));
