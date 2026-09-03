import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AssistantChatMessage } from "../api/types";

const WELCOME: AssistantChatMessage = {
  role: "assistant",
  content:
    "Namaste! I'm Saarthi, your AI loan assistant. I can help you with loan eligibility, EMI calculations, document requirements, and guide you through the entire loan process. How can I assist you today?",
};

interface PersistedChat {
  state?: {
    history?: AssistantChatMessage[];
  };
}

interface ChatState {
  history: AssistantChatMessage[];

  append: (msg: AssistantChatMessage) => void;

  replaceLast: (msg: AssistantChatMessage) => void;

  reset: () => void;

  clearForLogout: () => void;
}

export const useChat = create<ChatState>()(
  persist(
    (set) => ({
      history: [WELCOME],

      append: (msg) =>
        set((state) => ({
          history: [...state.history, msg],
        })),

      replaceLast: (msg) =>
        set((state) => ({
          history: state.history.length
            ? [...state.history.slice(0, -1), msg]
            : [WELCOME],
        })),

      reset: () =>
        set({
          history: [WELCOME],
        }),

      clearForLogout: () =>
        set({
          history: [WELCOME],
        }),
    }),

    {
      name: "saarthi_chat_anon",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);


/**
 * Switch chat storage namespace.
 *
 * User 1 → saarthi_chat_1
 * User 2 → saarthi_chat_2
 * Anonymous → saarthi_chat_anon
 */
export async function scopeChat(userId: number | null) {
  const storageKey = userId
    ? `saarthi_chat_${userId}`
    : "saarthi_chat_anon";

  console.log(
    `[CHAT] Switching chat scope → ${
      userId ? `user ${userId}` : "anonymous"
    }`
  );

  const storage = sessionStorage;

  try {
    /*
     * IMPORTANT:
     * Read the target user's storage BEFORE changing
     * Zustand's persistence configuration.
     */
    const raw = storage.getItem(storageKey);

    let history: AssistantChatMessage[] = [WELCOME];

    if (raw) {
      try {
        const parsed: PersistedChat = JSON.parse(raw);

        const storedHistory = parsed?.state?.history;

        if (Array.isArray(storedHistory) && storedHistory.length > 0) {
          history = storedHistory;
        }
      } catch (error) {
        console.warn(
          `[CHAT] Failed to parse stored chat for ${storageKey}`,
          error
        );
      }
    }

    /*
     * Change Zustand's persistence namespace.
     */
    useChat.persist.setOptions({
      name: storageKey,
    });

    /*
     * Replace the in-memory state with ONLY the target
     * user's conversation.
     *
     * Since we already loaded the correct namespace above,
     * we don't need rehydrate() here.
     */
    useChat.setState({
      history,
    });

    console.log(
      `[CHAT] Chat scope ready → ${storageKey} (${history.length} messages)`
    );
  } catch (error) {
    console.error(
      `[CHAT] Failed to switch chat scope → ${storageKey}`,
      error
    );

    /*
     * Fail closed:
     * if anything goes wrong, NEVER display another
     * user's conversation.
     */
    useChat.persist.setOptions({
      name: storageKey,
    });

    useChat.setState({
      history: [WELCOME],
    });
  }
}