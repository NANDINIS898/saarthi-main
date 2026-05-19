import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import type { KYCSession } from "../api/types";
import { useAuth } from "../store/auth";
import { AppHeader } from "../components/AppHeader";

/**
 * Stage machine for the live KYC session.
 *
 *   intro  ──► preview ──► recording(face) ──► recording(id) ──►
 *   uploading ──► verifying ──► done | error
 *
 * The webcam stays on from "preview" through end of "recording(id)";
 * we capture one Aadhaar still frame during the ID phase and the whole
 * stream is recorded as the liveness video.
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

  // Tear down camera + recorder on unmount or stage error.
  const stopCamera = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch { /* noop */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // ── Stage 1 — user clicks "Begin": create session + ask for camera ──────
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
    setStage("preview");                       // mounts the <video> element
    setCountdown(PREVIEW_COUNTDOWN_SECONDS);
  }

  // Attach the camera stream to the <video> element AFTER it mounts.
  // (Doing this inside begin() doesn't work because <video> only renders
  // once stage flips to "preview".)
  useEffect(() => {
    const cameraStages: Stage[] = ["preview", "recording_face", "recording_id"];
    if (!cameraStages.includes(stage)) return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (v && s && v.srcObject !== s) {
      v.srcObject = s;
      v.play().catch(() => { /* autoplay policy — muted+playsInline should allow it */ });
    }
  }, [stage]);

  // ── Stage 2 — preview countdown then start recording the face phase ─────
  useEffect(() => {
    if (stage !== "preview") return;
    if (countdown <= 0) {
      startRecording();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, countdown]);

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;

    chunksRef.current = [];
    const mime = pickMime();
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(500); // emit chunks every 500ms so we don't lose data on crash
    recorderRef.current = recorder;

    setStage("recording_face");
    setPhaseSeconds(FACE_PHASE_SECONDS);
  }

  // ── Stage 3 — count down face phase, then switch to ID phase ────────────
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

  // Capture the Aadhaar still 1 second before the ID phase ends so the card
  // is centered. We just grab the current video frame.
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
    canvas.toBlob(
      (b) => { if (b) aadhaarBlobRef.current = b; },
      "image/jpeg",
      0.92,
    );
  }

  // ── Stage 4 — stop recorder, upload video + Aadhaar, run verify ─────────
  async function finishAndUpload() {
    const recorder = recorderRef.current;
    if (!recorder || !sessionId) return;

    // Wait for the recorder to finalize its blob.
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    stopCamera();

    const videoBlob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "video/webm" });
    const aadhaarBlob = aadhaarBlobRef.current;

    setStage("uploading");
    try {
      // Upload video
      const vFd = new FormData();
      vFd.append(
        "file",
        new File([videoBlob], "session.webm", { type: videoBlob.type || "video/webm" }),
      );
      await api.post(`/kyc/session/${sessionId}/upload-video`, vFd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // Upload Aadhaar still as the "front" image
      if (!aadhaarBlob) throw new Error("Could not capture Aadhaar frame from video.");
      const aFd = new FormData();
      aFd.append(
        "file",
        new File([aadhaarBlob], "aadhaar_front.jpg", { type: "image/jpeg" }),
      );
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

  // ── UI ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen">
      <AppHeader subtitle="Video onboarding · live KYC session" />

      <main className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        <button
          onClick={() => { stopCamera(); navigate("/dashboard"); }}
          className="text-xs text-gray-500 hover:underline"
        >
          ← Cancel and go back
        </button>
        {stage === "intro" && <Intro onBegin={begin} />}

        {(stage === "preview" || stage === "recording_face" || stage === "recording_id") && (
          <RecordingView
            videoRef={videoRef}
            stage={stage}
            countdown={countdown}
            phaseSeconds={phaseSeconds}
          />
        )}

        {(stage === "uploading" || stage === "verifying") && (
          <ProcessingView stage={stage} />
        )}

        {stage === "done" && result && (
          <DoneView result={result} onBack={() => navigate("/dashboard")} />
        )}

        {stage === "error" && (
          <ErrorView
            message={error || "Something went wrong"}
            onRetry={() => { setError(null); setStage("intro"); }}
            onBack={() => navigate("/dashboard")}
          />
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-views
// ─────────────────────────────────────────────────────────────────────────────

function Intro({ onBegin }: { onBegin: () => void }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900">Enter video session</h2>
      <p className="text-sm text-gray-500 mt-1">
        We'll record a short video to verify it's really you. Two steps, about 12 seconds in total:
      </p>
      <ol className="text-sm text-gray-700 mt-4 space-y-2 list-decimal list-inside">
        <li>Look at the camera and blink naturally (liveness check)</li>
        <li>Hold your Aadhaar card in front of the camera (ID capture)</li>
      </ol>
      <div className="bg-[#f0f0f8] rounded-lg px-3 py-2 text-xs text-[#6C63FF] mt-4">
        Make sure you're in good lighting and your face fits within the frame.
      </div>
      <button
        onClick={onBegin}
        className="mt-5 w-full bg-[#6C63FF] hover:bg-[#5a52d6] text-white font-medium rounded-lg py-2.5 text-sm"
      >
        Begin video session
      </button>
    </section>
  );
}

function RecordingView({
  videoRef, stage, countdown, phaseSeconds,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stage: Stage;
  countdown: number;
  phaseSeconds: number;
}) {
  const isPreview = stage === "preview";
  const isFace = stage === "recording_face";
  const isId = stage === "recording_id";

  const instruction = isPreview
    ? "Position your face in the frame"
    : isFace
      ? "Look at the camera and blink"
      : "Hold your Aadhaar card in front of the camera";

  const sub = isPreview
    ? `Recording starts in ${countdown}…`
    : isFace
      ? `${phaseSeconds}s · liveness check`
      : `${phaseSeconds}s · capturing your ID`;

  return (
    <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="relative bg-black aspect-video">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        {/* Recording badge */}
        {(isFace || isId) && (
          <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            REC
          </div>
        )}
        {/* Countdown overlay during preview */}
        {isPreview && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-white text-7xl font-bold drop-shadow-lg">{countdown}</div>
          </div>
        )}
        {/* Face guide ring */}
        <div className={`absolute inset-0 flex items-center justify-center pointer-events-none`}>
          <div className={`w-56 h-56 md:w-72 md:h-72 border-4 ${isId ? "border-[#6C63FF]" : "border-white/60"} rounded-full`} />
        </div>
      </div>
      <div className="p-4">
        <p className="text-sm font-medium text-gray-900">{instruction}</p>
        <p className="text-xs text-gray-500 mt-1">{sub}</p>
        <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#6C63FF] transition-all duration-500"
            style={{
              width: isPreview
                ? `${((PREVIEW_COUNTDOWN_SECONDS - countdown) / PREVIEW_COUNTDOWN_SECONDS) * 33}%`
                : isFace
                  ? `${33 + ((FACE_PHASE_SECONDS - phaseSeconds) / FACE_PHASE_SECONDS) * 33}%`
                  : `${66 + ((ID_PHASE_SECONDS - phaseSeconds) / ID_PHASE_SECONDS) * 34}%`,
            }}
          />
        </div>
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
    <section className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
      <div className="inline-block w-10 h-10 border-4 border-[#6C63FF] border-t-transparent rounded-full animate-spin" />
      <p className="text-base font-medium text-gray-900 mt-4">{label}</p>
      <p className="text-xs text-gray-500 mt-2">{sub}</p>
    </section>
  );
}

function DoneView({ result, onBack }: { result: KYCSession; onBack: () => void }) {
  const approved = result.status === "approved";
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className={`rounded-xl p-4 ${approved ? "bg-emerald-50" : "bg-amber-50"}`}>
        <p className={`text-sm font-semibold ${approved ? "text-emerald-700" : "text-amber-700"}`}>
          {approved ? "✓ Identity verified" : "Verification did not pass"}
        </p>
        {result.failure_reason && (
          <p className="text-xs text-amber-700 mt-1">{result.failure_reason}</p>
        )}
      </div>
      <div className="mt-4 space-y-2">
        <Row label="Face match"
             value={result.face_match_score !== null ? `${(result.face_match_score * 100).toFixed(1)} %` : "—"} />
        <Row label="Liveness"
             value={result.liveness_score !== null ? `${(result.liveness_score * 100).toFixed(1)} %` : "—"} />
        <Row label="Aadhaar OCR"
             value={result.ocr_extracted && typeof result.ocr_extracted === "object"
               ? (result.ocr_extracted.full_name as string) || "Readable"
               : "Not run"} />
      </div>
      <button
        onClick={onBack}
        className="mt-5 w-full bg-[#6C63FF] hover:bg-[#5a52d6] text-white font-medium rounded-lg py-2.5 text-sm"
      >
        Back to dashboard
      </button>
    </section>
  );
}

function ErrorView({
  message, onRetry, onBack,
}: { message: string; onRetry: () => void; onBack: () => void }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="rounded-xl bg-red-50 border border-red-200 p-4">
        <p className="text-sm font-semibold text-red-700">Something went wrong</p>
        <p className="text-xs text-red-700 mt-1 break-words">{message}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={onRetry}
                className="bg-[#6C63FF] hover:bg-[#5a52d6] text-white font-medium rounded-lg py-2 text-sm">
          Try again
        </button>
        <button onClick={onBack}
                className="bg-white border border-gray-300 text-gray-700 rounded-lg py-2 text-sm">
          Back to dashboard
        </button>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right max-w-[60%] break-words">{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Pick a MediaRecorder mimeType the browser supports. */
function pickMime(): string {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "";
}
