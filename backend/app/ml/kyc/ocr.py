"""
Aadhaar OCR via Groq Vision.

We send the Aadhaar image to Llama 4 Scout and ask it to return a strict JSON
object with the fields we need. The model is allowed to return null for any
field it can't read confidently.
"""

from typing import Any

from app.ml.kyc.groq_vision import call_vision_json
from app.utils.logger import logger


_OCR_SYSTEM = (
    "You are an OCR system that reads Indian Aadhaar cards. "
    "Reply with ONLY a JSON object. Never include prose. "
    "If a field is not visible or you are not confident, set it to null."
)

_OCR_USER = """Extract these fields from the Aadhaar image:

{
  "full_name": "string or null",
  "dob": "YYYY-MM-DD or DD/MM/YYYY string, or null",
  "gender": "M or F or null",
  "aadhaar_number_last4": "string of 4 digits, or null (NEVER return full Aadhaar)",
  "address": "string or null",
  "card_side_detected": "front or back or both or unknown",
  "is_readable": true,
  "notes": "short string describing any issues, or empty string"
}

Return only that JSON. Do not include the full 12-digit Aadhaar number — return only the LAST FOUR digits for privacy."""


def extract_aadhaar_fields(image_bytes: bytes, mime: str = "image/jpeg") -> dict[str, Any]:
    """
    Run Aadhaar OCR.

    Returns a dict that always contains at least:
      - is_readable: bool
      - full_name, dob, gender, address, aadhaar_number_last4: optional strings
      - card_side_detected: str
    """
    data = call_vision_json(
        system_prompt=_OCR_SYSTEM,
        user_prompt=_OCR_USER,
        images=[(image_bytes, mime)],
        max_tokens=600,
    )
    # Normalize: ensure expected keys exist even if model omitted them.
    data.setdefault("is_readable", True)
    for k in ("full_name", "dob", "gender", "address", "aadhaar_number_last4"):
        data.setdefault(k, None)
    data.setdefault("card_side_detected", "unknown")
    data.setdefault("notes", "")

    logger.info(
        f"OCR done — readable={data['is_readable']} "
        f"name={'set' if data['full_name'] else 'null'} "
        f"dob={'set' if data['dob'] else 'null'}"
    )
    return data
