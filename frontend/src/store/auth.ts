import { create } from "zustand";
import { api } from "../api/client";
import type { TokenResponse, User } from "../api/types";
import { useChat, scopeChat } from "./chat";

const TOKEN_KEY = "saarthi_token";

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;

  init: () => Promise<void>;
  signup: (payload: SignupPayload) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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

  /**
   * Called once when the application starts.
   * Restores authentication and loads the correct user's chat namespace.
   */
  init: async () => {
    const token = localStorage.getItem(TOKEN_KEY);

    if (!token) {
      // No authenticated user → anonymous chat namespace
      await scopeChat(null);
      return;
    }

    set({ loading: true });

    try {
      const { data } = await api.get<User>("/auth/me");

      set({
        user: data,
        token,
      });

      console.log(`[AUTH] Session restored for user ${data.id}`);

      // IMPORTANT:
      // Restore the chat belonging to this authenticated user.
      await scopeChat(data.id);

      console.log(`[AUTH] Chat loaded for user ${data.id}`);
    } catch {
      console.log("[AUTH] Session invalid");

      localStorage.removeItem(TOKEN_KEY);

      // Clear previous user's in-memory chat.
      useChat.getState().clearForLogout();

      // Switch to anonymous namespace.
      await scopeChat(null);

      set({
        user: null,
        token: null,
      });
    } finally {
      set({ loading: false });
    }
  },

  signup: async (payload) => {
    set({ loading: true });

    try {
      await api.post<User>("/auth/signup", payload);

      // Automatically login after signup.
      await get().login(payload.email, payload.password);
    } finally {
      set({ loading: false });
    }
  },

  login: async (email, password) => {
    set({ loading: true });

    try {
      const { data } = await api.post<TokenResponse>(
        "/auth/login",
        {
          email,
          password,
        }
      );

      localStorage.setItem(TOKEN_KEY, data.access_token);

      set({
        token: data.access_token,
        user: null,
      });

      // Get the actual authenticated user from backend.
      await get().refreshUser();

      const user = get().user;

      if (!user) {
        throw new Error(
          "Login succeeded but authenticated user could not be loaded."
        );
      }

      console.log(`[AUTH] Logged in as user ${user.id}`);

      // Switch Zustand chat storage to this user's namespace.
      await scopeChat(user.id);

      console.log(`[AUTH] Chat loaded for user ${user.id}`);
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    console.log("[AUTH] Logging out");

    // 1. Remove authentication token.
    localStorage.removeItem(TOKEN_KEY);

    // 2. Immediately clear previous user's in-memory chat.
    useChat.getState().clearForLogout();

    // 3. Switch chat storage to anonymous namespace.
    await scopeChat(null);

    // 4. Clear authenticated user.
    set({
      user: null,
      token: null,
    });

    console.log("[AUTH] Logout complete");
  },

  refreshUser: async () => {
    const { data } = await api.get<User>("/auth/me");

    set({
      user: data,
    });
  },
}));