import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import type { KYCSession } from "../api/types";
import { useAuth } from "../store/auth";
import { PageShell } from "../components/PageShell";

/**
 * Stage machine for the live KYC session:
 *   intro → preview → recording(face) → recording(id) → uploading → verifying
 *   → done | error
 *
 * The 6 visible steps in the stepper map to:
 *   1 Welcome   → intro
 *   2 Liveness  → preview + recording_face
 *   3 Aadhaar   → recording_id
 *   4 Income    → uploading (we don't capture income separately; placeholder)
 *   5 Review    → verifying
 *   6 Complete  → done
 */
type Stage =
  | "intro"
  | "preview"
  | "recording_face"
  | "recording_id"
  | "uploading"
  | "verifying"
  | "done"
  | "error";

const FACE_PHASE_SECONDS = 6;
const ID_PHASE_SECONDS = 6;
const PREVIEW_COUNTDOWN_SECONDS = 3;

const STEPS = ["Welcome", "Liveness Check", "Aadhaar Scan", "Income Details", "Review", "Complete"];

function stepIndex(stage: Stage): number {
  switch (stage) {
    case "intro": return 0;
    case "preview":
    case "recording_face": return 1;
    case "recording_id": return 2;
    case "uploading": return 3;
    case "verifying": return 4;
    case "done": return 5;
    default: return 0;
  }
}

export default function KycSession() {
  const navigate = useNavigate();
  const refreshUser = useAuth((s) => s.refreshUser);

  const [stage, setStage] = useState<Stage>("intro");
  const [countdown, setCountdown] = useState(PREVIEW_COUNTDOWN_SECONDS);
  const [phaseSeconds, setPhaseSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KYCSession | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const aadhaarBlobRef = useRef<Blob | null>(null);

  const stopCamera = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch { /* noop */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  async function begin() {
    setError(null);
    try {
      const { data } = await api.post<KYCSession>("/kyc/session/start");
      setSessionId(data.id);
    } catch (err) {
      setError(apiErrorMessage(err));
      setStage("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission denied. Enable it in your browser and try again."
          : err instanceof Error && err.name === "NotFoundError"
            ? "No camera found on this device."
            : "Could not access camera."
      );
      setStage("error");
      return;
    }
    streamRef.current = stream;
    setStage("preview");
    setCountdown(PREVIEW_COUNTDOWN_SECONDS);
  }

  useEffect(() => {
    const cameraStages: Stage[] = ["preview", "recording_face", "recording_id"];
    if (!cameraStages.includes(stage)) return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (v && s && v.srcObject !== s) {
      v.srcObject = s;
      v.play().catch(() => { /* autoplay */ });
    }
  }, [stage]);

  useEffect(() => {
    if (stage !== "preview") return;
    if (countdown <= 0) { startRecording(); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, countdown]);

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const mime = pickMime();
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.start(500);
    recorderRef.current = recorder;
    setStage("recording_face");
    setPhaseSeconds(FACE_PHASE_SECONDS);
  }

  useEffect(() => {
    if (stage !== "recording_face" && stage !== "recording_id") return;
    if (phaseSeconds <= 0) {
      if (stage === "recording_face") {
        setStage("recording_id");
        setPhaseSeconds(ID_PHASE_SECONDS);
      } else {
        captureAadhaarFrame();
        finishAndUpload();
      }
      return;
    }
    const t = setTimeout(() => setPhaseSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, phaseSeconds]);

  useEffect(() => {
    if (stage !== "recording_id" || phaseSeconds !== 1) return;
    captureAadhaarFrame();
  }, [stage, phaseSeconds]);

  function captureAadhaarFrame() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => { if (b) aadhaarBlobRef.current = b; }, "image/jpeg", 0.92);
  }

  async function finishAndUpload() {
    const recorder = recorderRef.current;
    if (!recorder || !sessionId) return;

    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    stopCamera();

    const videoBlob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "video/webm" });
    const aadhaarBlob = aadhaarBlobRef.current;

    setStage("uploading");
    try {
      const vFd = new FormData();
      vFd.append("file", new File([videoBlob], "session.webm", { type: videoBlob.type || "video/webm" }));
      await api.post(`/kyc/session/${sessionId}/upload-video`, vFd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (!aadhaarBlob) throw new Error("Could not capture Aadhaar frame from video.");
      const aFd = new FormData();
      aFd.append("file", new File([aadhaarBlob], "aadhaar_front.jpg", { type: "image/jpeg" }));
      await api.post(`/kyc/session/${sessionId}/upload-aadhaar?side=front`, aFd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setStage("verifying");
      const { data } = await api.post<KYCSession>(`/kyc/session/${sessionId}/verify`);
      setResult(data);
      await refreshUser();
      setStage("done");
    } catch (err) {
      setError(apiErrorMessage(err));
      setStage("error");
    }
  }

  const current = stepIndex(stage);
  const total = STEPS.length;

  return (
    <PageShell title="Video KYC" subtitle="Complete your verification">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Stepper card */}
        <section className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Video KYC Verification</h2>
              <p className="text-sm text-gray-500 mt-0.5">Step {Math.min(current + 1, total)} of {total}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium px-2.5 py-1 rounded-lg">
              <LockIcon /> Secured &amp; Encrypted
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-5">
            <div
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${((current + 1) / total) * 100}%` }}
            />
          </div>

          {/* Step dots */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {STEPS.map((label, i) => {
              const done = i < current;
              const active = i === current;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                    done
                      ? "bg-emerald-500 text-white"
                      : active
                        ? "bg-blue-500 text-white ring-4 ring-blue-100"
                        : "bg-gray-100 text-gray-400"
                  }`}>
                    {done ? "✓" : i + 1}
                  </span>
                  <span className={`text-xs truncate ${active ? "text-blue-600 font-semibold" : done ? "text-gray-700" : "text-gray-400"}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Main content + side panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: video / stage UI */}
          <div className="lg:col-span-2">
            {stage === "intro" && <IntroPanel onBegin={begin} />}

            {(stage === "preview" || stage === "recording_face" || stage === "recording_id") && (
              <RecordingView
                videoRef={videoRef}
                stage={stage}
                countdown={countdown}
                phaseSeconds={phaseSeconds}
              />
            )}

            {(stage === "uploading" || stage === "verifying") && <ProcessingView stage={stage} />}

            {stage === "done" && result && (
              <DonePanel result={result} onBack={() => navigate("/applications")} />
            )}

            {stage === "error" && (
              <ErrorPanel
                message={error || "Something went wrong"}
                onRetry={() => { setError(null); setStage("intro"); }}
                onBack={() => navigate("/assistant")}
              />
            )}
          </div>

          {/* Right: side panel with feature list */}
          <SidePanel />
        </div>
      </div>
    </PageShell>
  );
}

// ─── Subviews ──────────────────────────────────────────────────────────────

function IntroPanel({ onBegin }: { onBegin: () => void }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col items-center text-center min-h-[480px] justify-center">
      <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-5">
        <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      </div>
      <h3 className="text-xl font-semibold text-gray-900">Ready for Video KYC?</h3>
      <p className="text-sm text-gray-500 mt-2 max-w-md">
        We'll verify your identity through a quick video session. Make sure you have good lighting and a stable internet connection.
      </p>
      <button
        onClick={onBegin}
        className="mt-6 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg px-6 py-2.5 text-sm inline-flex items-center gap-2"
      >
        Start Video KYC <span>›</span>
      </button>
    </section>
  );
}

function RecordingView({
  videoRef, stage, countdown, phaseSeconds,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stage: Stage; countdown: number; phaseSeconds: number;
}) {
  const isPreview = stage === "preview";
  const isFace = stage === "recording_face";
  const isId = stage === "recording_id";

  const instruction = isPreview
    ? "Position your face in the frame"
    : isFace ? "Look at the camera and blink"
    : "Hold your Aadhaar card in front of the camera";

  const sub = isPreview ? `Recording starts in ${countdown}…`
    : isFace ? `${phaseSeconds}s · liveness check`
    : `${phaseSeconds}s · capturing your ID`;

  return (
    <section className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="relative bg-black aspect-video">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        {(isFace || isId) && (
          <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            REC
          </div>
        )}
        {isPreview && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-white text-7xl font-bold drop-shadow-lg">{countdown}</div>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className={`w-56 h-56 md:w-72 md:h-72 border-4 rounded-full ${isId ? "border-emerald-400" : "border-white/60"}`} />
        </div>
      </div>
      <div className="p-5">
        <p className="text-base font-medium text-gray-900">{instruction}</p>
        <p className="text-xs text-gray-500 mt-1">{sub}</p>
      </div>
    </section>
  );
}

function ProcessingView({ stage }: { stage: Stage }) {
  const label = stage === "uploading" ? "Uploading your session…" : "Verifying with our AI…";
  const sub = stage === "uploading"
    ? "Sending the encrypted video and ID image to our server"
    : "Running OCR, face match, and liveness checks (≈ 10–20s)";
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-10 text-center">
      <div className="inline-block w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-base font-medium text-gray-900 mt-4">{label}</p>
      <p className="text-xs text-gray-500 mt-2">{sub}</p>
    </section>
  );
}

function DonePanel({ result, onBack }: { result: KYCSession; onBack: () => void }) {
  const approved = result.status === "approved";
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-6">
      <div className={`rounded-xl p-4 ${approved ? "bg-emerald-50 border border-emerald-200" : "bg-amber-50 border border-amber-200"}`}>
        <p className={`text-sm font-semibold ${approved ? "text-emerald-700" : "text-amber-700"}`}>
          {approved ? "✓ Identity verified" : "Verification did not pass"}
        </p>
        {result.failure_reason && <p className="text-xs text-amber-700 mt-1">{result.failure_reason}</p>}
      </div>
      <div className="mt-4 space-y-2">
        <Row label="Face match" value={result.face_match_score !== null ? `${(result.face_match_score * 100).toFixed(1)} %` : "—"} />
        <Row label="Liveness" value={result.liveness_score !== null ? `${(result.liveness_score * 100).toFixed(1)} %` : "—"} />
        <Row label="Aadhaar OCR" value={result.ocr_extracted && typeof result.ocr_extracted === "object"
          ? (result.ocr_extracted.full_name as string) || "Readable"
          : "Not run"} />
      </div>
      <button
        onClick={onBack}
        className="mt-5 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg py-2.5 text-sm"
      >
        Continue to Applications
      </button>
    </section>
  );
}

function ErrorPanel({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-6">
      <div className="rounded-xl bg-red-50 border border-red-200 p-4">
        <p className="text-sm font-semibold text-red-700">Something went wrong</p>
        <p className="text-xs text-red-700 mt-1 break-words">{message}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={onRetry} className="bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg py-2 text-sm">Try again</button>
        <button onClick={onBack} className="bg-white border border-gray-300 text-gray-700 rounded-lg py-2 text-sm">Back</button>
      </div>
    </section>
  );
}

function SidePanel() {
  return (
    <aside className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4 h-fit">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>
        <div>
          <p className="text-base font-semibold text-gray-900">Welcome</p>
          <p className="text-xs text-gray-500">Introduction to Video KYC</p>
        </div>
      </div>

      <FeatureRow title="Liveness Detection" desc="Verify you're a real person" />
      <FeatureRow title="Aadhaar Verification" desc="Scan your Aadhaar card" />
      <FeatureRow title="Income Declaration" desc="Speak your income details" />
    </aside>
  );
}

function FeatureRow({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-3">
      <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        ✓
      </span>
      <div>
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="text-xs text-gray-500">{desc}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right max-w-[60%] break-words">{value}</span>
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function pickMime(): string {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}
