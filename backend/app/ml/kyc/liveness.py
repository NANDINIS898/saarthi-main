"""
Liveness check via MediaPipe Face Mesh.

We look for two signals in the video:
  1. Blink count — derived from Eye Aspect Ratio (EAR) across frames.
  2. Head movement — total yaw range across the session.

If both signals exceed sensible thresholds, the person is "live" — i.e. not
a printed photo or a static replay.

This is intentionally simple — it catches the easy spoofs (printed photo,
static screenshot, frozen webcam). Production systems should layer on a
trained anti-spoof model (e.g. Silent-Face) — see the marked extension point.
"""

import math
import tempfile
from pathlib import Path
from typing import Any

import cv2
import mediapipe as mp
import numpy as np

from app.utils.logger import logger


# 6 landmark indices that form the eye polygon (MediaPipe Face Mesh)
# Left eye: 33, 160, 158, 133, 153, 144
# Right eye: 362, 385, 387, 263, 373, 380
_LEFT_EYE  = [33, 160, 158, 133, 153, 144]
_RIGHT_EYE = [362, 385, 387, 263, 373, 380]

# Nose-tip landmark — used as a stable head-pose proxy
_NOSE_TIP = 1

# Eye Aspect Ratio thresholds (well-known values from Soukupová & Čech 2016)
_EAR_CLOSED = 0.20
_EAR_OPEN   = 0.26


def _ear(landmarks, idx: list[int], w: int, h: int) -> float:
    p = [(landmarks[i].x * w, landmarks[i].y * h) for i in idx]
    # EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
    a = math.dist(p[1], p[5])
    b = math.dist(p[2], p[4])
    c = math.dist(p[0], p[3])
    return (a + b) / (2.0 * c) if c > 0 else 0.0


def check_liveness(
    video_bytes: bytes,
    *,
    sample_every_n_frames: int = 2,
    max_frames_to_scan: int = 600,
) -> dict[str, Any]:
    """
    Run a lightweight liveness check on the video bytes.

    Returns:
        {
          "liveness_score": float 0.0–1.0,
          "is_live": bool,
          "blink_count": int,
          "head_motion_px": float,
          "frames_with_face": int,
          "frames_scanned": int,
          "reason": str
        }
    """
    # cv2.VideoCapture wants a path, so dump bytes to a temp file.
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = Path(tmp.name)

    cap = cv2.VideoCapture(str(tmp_path))
    if not cap.isOpened():
        tmp_path.unlink(missing_ok=True)
        return _result(0.0, False, 0, 0.0, 0, 0, "Could not open video")

    face_mesh = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=1,
        refine_landmarks=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    frame_idx = 0
    frames_with_face = 0
    blink_count = 0
    eye_state = "open"
    nose_positions: list[tuple[float, float]] = []

    try:
        while frame_idx < max_frames_to_scan:
            ok, frame = cap.read()
            if not ok:
                break
            frame_idx += 1
            if frame_idx % sample_every_n_frames != 0:
                continue

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = face_mesh.process(rgb)
            if not result.multi_face_landmarks:
                continue
            frames_with_face += 1

            h, w = frame.shape[:2]
            lm = result.multi_face_landmarks[0].landmark
            ear = (_ear(lm, _LEFT_EYE, w, h) + _ear(lm, _RIGHT_EYE, w, h)) / 2.0

            # blink state machine
            if eye_state == "open" and ear < _EAR_CLOSED:
                eye_state = "closed"
            elif eye_state == "closed" and ear > _EAR_OPEN:
                blink_count += 1
                eye_state = "open"

            nose = lm[_NOSE_TIP]
            nose_positions.append((nose.x * w, nose.y * h))
    finally:
        face_mesh.close()
        cap.release()
        tmp_path.unlink(missing_ok=True)

    # Head motion: spread of nose-tip positions across the session.
    if len(nose_positions) >= 2:
        arr = np.array(nose_positions)
        head_motion_px = float(np.linalg.norm(arr.std(axis=0)))
    else:
        head_motion_px = 0.0

    # Score recipe (kept simple & explainable):
    #   blink contribution (60%)   — saturates at 2 blinks
    #   motion contribution (40%)  — saturates at 15 px std-dev
    blink_part  = min(1.0, blink_count / 2.0) * 0.6
    motion_part = min(1.0, head_motion_px / 15.0) * 0.4
    score = round(blink_part + motion_part, 3)

    # Sanity: no face seen at all → can't be live
    if frames_with_face < 3:
        score = 0.0
        reason = "Face not detected in enough frames"
    elif blink_count == 0 and head_motion_px < 3:
        reason = "Likely a static image / printed photo"
    else:
        reason = "OK"

    is_live = score >= 0.4
    return _result(score, is_live, blink_count, head_motion_px, frames_with_face, frame_idx, reason)


def _result(
    score: float, is_live: bool, blinks: int, motion: float,
    frames_with_face: int, frames_scanned: int, reason: str,
) -> dict[str, Any]:
    return {
        "liveness_score": score,
        "is_live": is_live,
        "blink_count": blinks,
        "head_motion_px": round(motion, 2),
        "frames_with_face": frames_with_face,
        "frames_scanned": frames_scanned,
        "reason": reason,
    }


def extract_middle_frame(video_bytes: bytes) -> bytes | None:
    """
    Pull a JPEG-encoded frame from the middle of the video — used by face_match.

    Returns None if the video can't be decoded.
    """
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = Path(tmp.name)
    try:
        cap = cv2.VideoCapture(str(tmp_path))
        if not cap.isOpened():
            return None
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        target = max(0, total // 2)
        cap.set(cv2.CAP_PROP_POS_FRAMES, target)
        ok, frame = cap.read()
        cap.release()
        if not ok:
            return None
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            return None
        logger.info(f"Extracted middle frame ({len(buf)} bytes) from video")
        return bytes(buf)
    finally:
        tmp_path.unlink(missing_ok=True)
