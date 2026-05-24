import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import type {
  AssistantChatMessage, AssistantChatResponse, TranscribeResponse,
} from "../api/types";
import { PageShell } from "../components/PageShell";
import { useChat } from "../store/chat";

/**
 * Full-page AI Assistant. Same backend as the floating SaarthiAssistant
 * widget — POST /assistant/chat (text) and POST /assistant/transcribe (voice).
 *
 * Quick actions on the bottom send canned prompts so the user can self-serve
 * common requests (EMI, eligibility, document list) without typing.
 */
export default function Assistant() {
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<AssistantChatResponse["action_hint"]>(null);
  const history = useChat((s) => s.history);
  const appendMsg = useChat((s) => s.append);
  const resetChat = useChat((s) => s.reset);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  const stopMic = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch { /* noop */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);
  useEffect(() => () => stopMic(), [stopMic]);

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    setHint(null);
    appendMsg({ role: "user", content: trimmed });
    setInput("");
    setBusy(true);
    try {
      const { data } = await api.post<AssistantChatResponse>("/assistant/chat", {
        message: trimmed,
        application_id: null,
        history: history.slice(-10),
      });
      appendMsg({ role: "assistant", content: data.reply });
      setHint(data.action_hint);
    } catch (err) {
      const msg = apiErrorMessage(err);
      setError(msg);
      appendMsg({ role: "assistant", content: `Sorry — ${msg}` });
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecord() {
    if (recording) {
      const recorder = recorderRef.current;
      if (!recorder) { stopMic(); setRecording(false); return; }
      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      stopMic();
      setRecording(false);

      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
      if (blob.size === 0) return;
      setBusy(true);
      try {
        const fd = new FormData();
        fd.append("file", new File([blob], "voice.webm", { type: blob.type }));
        const { data } = await api.post<TranscribeResponse>("/assistant/transcribe", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        if (!data.text) { setError("Couldn't hear anything — try again."); return; }
        await sendText(data.text);
      } catch (err) {
        setError(apiErrorMessage(err));
      } finally {
        setBusy(false);
      }
      return;
    }

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
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }

  function followHint() {
    if (hint === "go_kyc") navigate("/kyc/session");
    else if (hint === "go_negotiate" || hint === "go_accept") navigate("/applications");
    setHint(null);
  }

  return (
    <PageShell
      title="AI Assistant"
      subtitle="Chat with Saarthi AI"
      rightSlot={
        <button
          onClick={resetChat}
          className="hidden sm:inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          title="Clear conversation"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          Clear chat
        </button>
      }
    >
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Chat scroll area */}
        <div className="bg-white border border-gray-200 rounded-2xl flex flex-col h-[60vh] min-h-[420px]">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
            {history.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}
            {busy && (
              <div className="flex gap-3">
                <BotAvatar />
                <div className="bg-gray-100 border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-500">
                  {recording ? "Listening…" : "Thinking…"}
                </div>
              </div>
            )}
            {hint && (
              <div className="flex justify-center">
                <button
                  onClick={followHint}
                  className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-medium rounded-full px-4 py-2"
                >
                  {hint === "go_kyc" && "→ Open Video KYC"}
                  {hint === "go_negotiate" && "→ Open negotiation"}
                  {hint === "go_accept" && "→ Open application"}
                </button>
              </div>
            )}
            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Quick actions</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <QuickAction
              icon={<CalculatorIcon />}
              label="Calculate EMI"
              onClick={() => sendText("Help me calculate the EMI for a loan.")}
            />
            <QuickAction
              icon={<TrendIcon />}
              label="Check Eligibility"
              onClick={() => sendText("Am I eligible for a loan? Can you check?")}
            />
            <QuickAction
              icon={<DocIcon />}
              label="Document List"
              onClick={() => sendText("What documents do I need to apply for a loan?")}
            />
          </div>
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); sendText(input); }}
          className="bg-white border border-gray-200 rounded-2xl px-3 py-2 flex items-center gap-2"
        >
          <button
            type="button"
            className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500"
            aria-label="Attach"
            title="Attach"
          >
            <AttachIcon />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy || recording}
            placeholder={recording ? "Listening…" : "Ask Saarthi anything about loans…"}
            className="flex-1 bg-transparent border-0 outline-none text-sm text-gray-800 placeholder:text-gray-400 px-2"
          />
          <button
            type="button"
            onClick={toggleRecord}
            disabled={busy && !recording}
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              recording
                ? "bg-red-500 text-white animate-pulse"
                : "hover:bg-gray-100 text-gray-500"
            } disabled:opacity-40`}
            aria-label={recording ? "Stop recording" : "Record voice"}
            title={recording ? "Stop and send" : "Record voice"}
          >
            <MicIcon />
          </button>
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="w-9 h-9 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center"
            aria-label="Send"
          >
            <SendIcon />
          </button>
        </form>
        <p className="text-[11px] text-gray-400 text-center">
          Saarthi AI may make mistakes. Verify important loan information with our team.
        </p>
      </div>
    </PageShell>
  );
}

function MessageBubble({ message }: { message: AssistantChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-emerald-500 text-white rounded-2xl rounded-br-md px-4 py-3 text-sm max-w-[80%]">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 items-start">
      <BotAvatar />
      <div className="bg-gray-50 border border-gray-200 rounded-2xl rounded-tl-md px-4 py-3 text-sm text-gray-800 max-w-[80%]">
        {message.content}
      </div>
    </div>
  );
}

function BotAvatar() {
  return (
    <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 mt-0.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4" />
        <line x1="8" y1="16" x2="8" y2="16" />
        <line x1="16" y1="16" x2="16" y2="16" />
      </svg>
    </div>
  );
}

function QuickAction({
  icon, label, onClick,
}: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-emerald-400 hover:shadow-sm transition-all text-left"
    >
      <span className="w-8 h-8 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center">
        {icon}
      </span>
      <span className="text-sm font-medium text-gray-800">{label}</span>
    </button>
  );
}

function pickAudioMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

// ─── Icons ─────────────────────────────────────────────────────────────────
function CalculatorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="8" y1="10" x2="8" y2="10" /><line x1="12" y1="10" x2="12" y2="10" /><line x1="16" y1="10" x2="16" y2="10" />
      <line x1="8" y1="14" x2="8" y2="14" /><line x1="12" y1="14" x2="12" y2="14" /><line x1="16" y1="14" x2="16" y2="14" />
      <line x1="8" y1="18" x2="8" y2="18" /><line x1="12" y1="18" x2="16" y2="18" />
    </svg>
  );
}
function TrendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}
function AttachIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
