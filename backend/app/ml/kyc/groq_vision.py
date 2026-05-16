"""
Thin Groq Vision wrapper.

We use Llama 4 Scout for two jobs:
  1. OCR — read name / DOB / address from Aadhaar
  2. Face similarity — compare a live video frame to the Aadhaar photo

Both calls follow the same pattern: send one or more images plus a JSON-schema
prompt, ask the model to reply with strict JSON, and `json.loads` the result.

This file is intentionally low-level — domain logic lives in ocr.py / face_match.py.
"""

import base64
import json
from typing import Iterable

from groq import Groq

from app.config import settings
from app.utils.logger import logger


# Multimodal Groq model used for vision tasks.
# Llama 4 Scout has strong OCR + scene-understanding for cheap.
VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"


def _client() -> Groq:
    if not settings.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set. Add it to .env.")
    return Groq(api_key=settings.GROQ_API_KEY)


def _image_part(image_bytes: bytes, mime: str = "image/jpeg") -> dict:
    """Encode raw bytes as a data-URL image content part for the chat API."""
    b64 = base64.b64encode(image_bytes).decode("ascii")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{mime};base64,{b64}"},
    }


def call_vision_json(
    *,
    system_prompt: str,
    user_prompt: str,
    images: Iterable[tuple[bytes, str]],
    max_tokens: int = 800,
    temperature: float = 0.0,
) -> dict:
    """
    Send images + prompts to Groq Vision, expect a JSON object back, return it as a dict.

    `images` is an iterable of (image_bytes, mime_type) tuples.
    Raises RuntimeError if the model doesn't return valid JSON.
    """
    content: list[dict] = [_image_part(b, m) for b, m in images]
    content.append({"type": "text", "text": user_prompt})

    client = _client()
    resp = client.chat.completions.create(
        model=VISION_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )

    raw = resp.choices[0].message.content or ""
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error(f"Groq vision returned non-JSON: {raw[:400]}")
        raise RuntimeError(f"Vision model did not return valid JSON: {e}")
