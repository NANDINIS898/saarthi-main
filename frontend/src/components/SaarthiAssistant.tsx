import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import type {
  AssistantChatMessage, AssistantChatResponse, TranscribeResponse,
} from "../api/types";

/**
 * Floating Saarthi assistant — a FAB in the bottom-right corner that
 * expands into a chat panel.
 *
 * What it does:
 *   - Voice input: press & hold the mic button → records audio → Groq Whisper STT
 *   - Text input: type a message
 *   - Chat: sends to /assistant/chat which knows about the user + (optionally)
 *     the current application id (derived from the URL path)
 *   - Action hints: if the LLM says "go negotiate", we surface a button that
 *     jumps the user to the right page
 *
 * This component is mounted globally in App.tsx so it persists across pages.
 */
export function SaarthiAssistant() {
  const navigate = useNavigate();
  const location = useLocation();
  const applicationIdInUrl = parseAppIdFromPath(location.pathname);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<AssistantChatResponse["action_hint"]>(null);
  const [history, setHistory] = useState<AssistantChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm Saarthi. Ask me about your loan, your credit score, " +
        "or what to do next. Tap the mic to talk.",
    },
  ]);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, open]);

  // Tear down mic on unmount or when panel closes
  const stopMic = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch { /* noop */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);
  useEffect(() => () => stopMic(), [stopMic]);

  // ── Send text to backend ────────────────────────────────────────────────
  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    setHint(null);
    const userMsg: AssistantChatMessage = { role: "user", content: trimmed };
    setHistory((h) => [...h, userMsg]);
    setInput("");
    setBusy(true);
    try {
      const { data } = await api.post<AssistantChatResponse>("/assistant/chat", {
        message: trimmed,
        application_id: applicationIdInUrl,
        history: history.slice(-10),
      });
      setHistory((h) => [...h, { role: "assistant", content: data.reply }]);
      setHint(data.action_hint);
    } catch (err) {
      const msg = apiErrorMessage(err);
      setError(msg);
      setHistory((h) => [...h, { role: "assistant", content: `Sorry — ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  // ── Start recording (push-to-talk) ──────────────────────────────────────
  async function startRecording() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone permission denied."
          : "Could not access microphone.",
      );
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];

    const mime = pickAudioMime();
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }

  // ── Stop recording, transcribe, send ────────────────────────────────────
  async function stopAndSend() {
    const recorder = recorderRef.current;
    if (!recorder) {
      stopMic();
      setRecording(false);
      return;
    }
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    stopMic();
    setRecording(false);

    const blob = new Blob(chunksRef.current, {
      type: chunksRef.current[0]?.type || "audio/webm",
    });
    if (blob.size === 0) return;

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", new File([blob], "voice.webm", { type: blob.type }));
      const { data } = await api.post<TranscribeResponse>("/assistant/transcribe", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (!data.text) {
        setError("Couldn't hear anything — please try again.");
        return;
      }
      // Hand the transcribed text straight to the chat endpoint.
      await sendText(data.text);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // ── Action-hint follow-up button ────────────────────────────────────────
  function followHint() {
    if (hint === "go_kyc") {
      navigate("/kyc/session");
      setOpen(false);
    } else if (hint === "go_negotiate" || hint === "go_accept") {
      const id = applicationIdInUrl;
      navigate(id ? `/loan/${id}` : "/applications");
      setOpen(false);
    }
    setHint(null);
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open Saarthi assistant"
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-[#6C63FF] hover:bg-[#5a52d6] text-white shadow-lg flex items-center justify-center"
      >
        <MicIcon />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[min(380px,calc(100vw-2rem))] max-h-[min(560px,calc(100vh-2rem))] bg-white border border-gray-200 rounded-2xl shadow-xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-[#6C63FF] text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">
            <MicIcon small />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Talk to Saarthi</p>
            <p className="text-[10px] text-white/70 leading-tight">
              {applicationIdInUrl ? `Context: application #${applicationIdInUrl}` : "Your AI loan assistant"}
            </p>
          </div>
        </div>
        <button onClick={() => { stopMic(); setOpen(false); }} className="text-white/80 hover:text-white text-lg leading-none">
          ×
        </button>
      </div>

      {/* Chat scroll area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-[#fafafd]">
        {history.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
              m.role === "user"
                ? "bg-[#6C63FF] text-white rounded-br-sm"
                : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm"
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-400">
              {recording ? "Recording…" : "Thinking…"}
            </div>
          </div>
        )}
        {hint && (
          <div className="flex justify-center">
            <button
              onClick={followHint}
              className="bg-[#f0f0f8] hover:bg-[#e5e3f7] text-[#6C63FF] text-xs font-medium rounded-full px-3 py-1.5"
            >
              {hint === "go_kyc" && "→ Open KYC session"}
              {hint === "go_negotiate" && "→ Open negotiation"}
              {hint === "go_accept" && "→ Open application"}
            </button>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5">
            {error}
          </div>
        )}
      </div>

      {/* Input row */}
      <form
        onSubmit={(e) => { e.preventDefault(); sendText(input); }}
        className="flex items-center gap-2 px-3 py-2 border-t border-gray-100 bg-white"
      >
        <button
          type="button"
          onMouseDown={startRecording}
          onMouseUp={stopAndSend}
          onMouseLeave={recording ? stopAndSend : undefined}
          onTouchStart={startRecording}
          onTouchEnd={stopAndSend}
          disabled={busy}
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            recording ? "bg-red-500 text-white animate-pulse" : "bg-[#f0f0f8] text-[#6C63FF] hover:bg-[#e5e3f7]"
          } disabled:opacity-50`}
          aria-label={recording ? "Release to send" : "Hold to talk"}
          title={recording ? "Release to send" : "Hold to talk"}
        >
          <MicIcon small />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy || recording}
          placeholder={recording ? "Listening…" : "Type or hold the mic…"}
          className="flex-1 border border-gray-200 rounded-full px-3 py-2 text-sm focus:outline-none focus:border-[#6C63FF]"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="bg-[#6C63FF] hover:bg-[#5a52d6] disabled:opacity-40 text-white text-sm rounded-full px-3 py-2 flex-shrink-0"
        >
          Send
        </button>
      </form>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function MicIcon({ small = false }: { small?: boolean }) {
  const s = small ? 16 : 20;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function pickAudioMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return "";
}

/** /loan/123 → 123, otherwise null. */
function parseAppIdFromPath(pathname: string): number | null {
  const m = pathname.match(/^\/loan\/(\d+)/);
  return m ? Number(m[1]) : null;
}
