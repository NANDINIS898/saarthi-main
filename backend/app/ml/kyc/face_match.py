"""
Face match via Groq Vision.

Why Groq Vision instead of FaceNet/ArcFace cosine similarity?
  - One dependency we already need (no dlib / tensorflow install on Windows).
  - The model returns a structured similarity verdict + confidence we can store.
  - For an MVP demo this is honest: real model, real reasoning, no fake numbers.

You can swap this for a true biometric matcher (DeepFace / InsightFace) later
WITHOUT changing kyc_pipeline_service.py — just keep the same return shape.
"""

from typing import Any

from app.ml.kyc.groq_vision import call_vision_json
from app.utils.logger import logger


_MATCH_SYSTEM = (
    "You are a forensic face-comparison assistant for a KYC system. "
    "Compare two images and decide whether they show the SAME person. "
    "Reply with ONLY a JSON object."
)

_MATCH_USER = """The FIRST image is a live selfie from a video session.
The SECOND image is the photo printed on the user's Aadhaar card.

Compare facial features (eyes, nose, jawline, head shape, distinguishing marks).
Ignore differences in age, lighting, pose, glasses, hair.

Return strictly this JSON:

{
  "same_person": true,
  "confidence": 0.0,
  "match_score": 0.0,
  "rationale": "one or two sentence explanation"
}

- same_person: boolean — your verdict.
- confidence: float 0.0–1.0 — how sure you are of the verdict.
- match_score: float 0.0–1.0 — your estimated facial similarity (1.0 = identical).
- rationale: short reasoning.

If either face is unclear, set same_person=false, confidence=0.0, match_score=0.0."""


def compare_faces(
    live_frame_bytes: bytes,
    aadhaar_image_bytes: bytes,
    live_mime: str = "image/jpeg",
    aadhaar_mime: str = "image/jpeg",
) -> dict[str, Any]:
    """
    Compare a live frame to the Aadhaar photo.

    Returns:
        {
          "same_person": bool,
          "confidence": float,
          "match_score": float,
          "rationale": str
        }
    """
    data = call_vision_json(
        system_prompt=_MATCH_SYSTEM,
        user_prompt=_MATCH_USER,
        images=[(live_frame_bytes, live_mime), (aadhaar_image_bytes, aadhaar_mime)],
        max_tokens=400,
    )
    data.setdefault("same_person", False)
    data.setdefault("confidence", 0.0)
    data.setdefault("match_score", 0.0)
    data.setdefault("rationale", "")

    # Clamp to sane ranges in case the model returned weird values.
    for k in ("confidence", "match_score"):
        try:
            data[k] = max(0.0, min(1.0, float(data[k])))
        except (TypeError, ValueError):
            data[k] = 0.0

    logger.info(
        f"Face match — same_person={data['same_person']} "
        f"match_score={data['match_score']:.3f} confidence={data['confidence']:.3f}"
    )
    return data
