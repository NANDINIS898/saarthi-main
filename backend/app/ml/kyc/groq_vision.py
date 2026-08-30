"""
Thin Groq Vision wrapper.

Used for:
  1. OCR — extract fields from Aadhaar
  2. Face similarity — compare live frame with Aadhaar photo

The wrapper:
  - sends image + prompt to Groq Vision
  - asks for JSON output
  - parses the JSON
  - raises a clear RuntimeError when the call or parsing fails
"""

import base64
import json
from typing import Iterable

from groq import Groq

from app.config import settings
from app.utils.logger import logger


# Groq multimodal vision model.
VISION_MODEL = "qwen/qwen3.6-27b"


def _client() -> Groq:
    """Create the Groq client."""

    if not settings.GROQ_API_KEY:
        raise RuntimeError(
            "GROQ_API_KEY is not set. Add it to .env."
        )

    return Groq(
        api_key=settings.GROQ_API_KEY
    )


def _image_part(
    image_bytes: bytes,
    mime: str = "image/jpeg",
) -> dict:
    """
    Convert raw image bytes into the format expected
    by Groq's multimodal chat API.
    """

    b64 = base64.b64encode(image_bytes).decode("ascii")

    return {
        "type": "image_url",
        "image_url": {
            "url": f"data:{mime};base64,{b64}"
        },
    }


def call_vision_json(
    *,
    system_prompt: str,
    user_prompt: str,
    images: Iterable[tuple[bytes, str]],
    max_tokens: int = 1000,
    temperature: float = 0.0,
) -> dict:
    """
    Send images + prompts to Groq Vision.

    Expected result:
        valid JSON object

    Raises:
        RuntimeError if:
          - Groq API call fails
          - model returns empty output
          - model returns invalid JSON
          - model returns JSON that isn't an object
    """

    # ---------------------------------------------------------
    # 1. Build multimodal message
    # ---------------------------------------------------------

    content: list[dict] = []

    image_count = 0

    for image_bytes, mime in images:
        content.append(
            _image_part(
                image_bytes,
                mime,
            )
        )

        image_count += 1

    # Add text instruction AFTER images.
    content.append(
        {
            "type": "text",
            "text": user_prompt,
        }
    )

    logger.info(
        "[Groq Vision] images=%d model=%s",
        image_count,
        VISION_MODEL,
    )

    # ---------------------------------------------------------
    # 2. Create Groq client
    # ---------------------------------------------------------

    client = _client()

    # ---------------------------------------------------------
    # 3. Call Groq
    # ---------------------------------------------------------

    try:
        logger.info(
            "[Groq Vision] Sending request to Groq..."
        )

        response = client.chat.completions.create(
            model=VISION_MODEL,

            messages=[
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {
                    "role": "user",
                    "content": content,
                },
            ],

            temperature=temperature,
            max_tokens=max_tokens,
            reasoning_effort="none",
            reasoning_format="hidden",
           
            

            # IMPORTANT:
            # Ask Groq to return valid JSON.
            #
            # Qwen 3.6 supports JSON Object Mode with images.
            response_format={
                "type": "json_object"
            },
           
        )

    except Exception as e:
        logger.exception(
            "[Groq Vision] API call failed"
        )

        raise RuntimeError(
            f"Groq Vision API call failed "
            f"({type(e).__name__}): {e}"
        ) from e

    # ---------------------------------------------------------
    # 4. Extract model output
    # ---------------------------------------------------------

    try:
        raw = (
            response
            .choices[0]
            .message
            .content
            or ""
        )

    except Exception as e:
        logger.exception(
            "[Groq Vision] Could not read model response."
        )

        raise RuntimeError(
            "Groq Vision returned an unexpected response."
        ) from e

    # ---------------------------------------------------------
    # 5. Empty response
    # ---------------------------------------------------------

    if not raw.strip():

        logger.error(
            "[Groq Vision] Model returned empty response."
        )

        raise RuntimeError(
            "Vision model returned an empty response."
        )

    logger.info(
        "[Groq Vision] Response received. length=%d",
        len(raw),
    )

    logger.debug(
        "[Groq Vision] Raw response: %s",
        raw,
    )

    # ---------------------------------------------------------
    # 6. Parse JSON
    # ---------------------------------------------------------

    try:
        data = json.loads(raw)

    except json.JSONDecodeError as e:

        logger.error(
            "[Groq Vision] Model returned invalid JSON."
        )

        logger.error(
            "[Groq Vision] Raw response: %s",
            raw[:1000],
        )

        raise RuntimeError(
            f"Vision model returned invalid JSON: {e}"
        ) from e

    # ---------------------------------------------------------
    # 7. Ensure response is a JSON object
    # ---------------------------------------------------------

    if not isinstance(data, dict):

        logger.error(
            "[Groq Vision] Expected JSON object, "
            "received %s.",
            type(data).__name__,
        )

        raise RuntimeError(
            "Vision model returned JSON, "
            "but it was not a JSON object."
        )

    # ---------------------------------------------------------
    # 8. Success
    # ---------------------------------------------------------

    logger.info(
        "[Groq Vision] JSON parsed successfully."
    )

    return data