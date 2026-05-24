import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AssistantChatMessage } from "../api/types";

/**
 * Persistent store for the AI Assistant conversation.
 *
 * Why a store instead of useState in the page component:
 *   - Both the floating <SaarthiAssistant /> and the full-page /assistant
 *     route should see the SAME conversation. Reopening the FAB after
 *     leaving /assistant must not wipe history.
 *   - SessionStorage (not localStorage) so the chat is per-tab and gets
 *     cleared on logout / window close — reasonable privacy default for a
 *     loan assistant.
 */

const WELCOME: AssistantChatMessage = {
  role: "assistant",
  content:
    "Namaste! I'm Saarthi, your AI loan assistant. I can help you with loan eligibility, EMI calculations, document requirements, and guide you through the entire loan process. How can I assist you today?",
};

interface ChatState {
  history: AssistantChatMessage[];
  append: (msg: AssistantChatMessage) => void;
  replaceLast: (msg: AssistantChatMessage) => void;
  reset: () => void;
}

export const useChat = create<ChatState>()(
  persist(
    (set) => ({
      history: [WELCOME],
      append: (msg) => set((s) => ({ history: [...s.history, msg] })),
      replaceLast: (msg) =>
        set((s) => ({
          history: s.history.length
            ? [...s.history.slice(0, -1), msg]
            : [msg],
        })),
      reset: () => set({ history: [WELCOME] }),
    }),
    {
      name: "saarthi_chat",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
