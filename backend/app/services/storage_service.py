"""
Supabase Storage client.

Why a thin httpx wrapper instead of supabase-py?
  - Zero SDK lock-in: Supabase Storage is a plain REST API.
  - Crystal-clear error handling (we own the response object).
  - One fewer transitive dep in our requirements.

All operations target the bucket named in settings.SUPABASE_STORAGE_BUCKET,
authenticated with the SERVICE ROLE key (server-only).
"""

import httpx
from fastapi import HTTPException, status

from app.config import settings
from app.utils.logger import logger


def _require_creds() -> None:
    """Fail fast with a helpful message if Supabase storage isn't configured."""
    missing = [
        name
        for name, val in [
            ("SUPABASE_URL", settings.SUPABASE_URL),
            ("SUPABASE_SERVICE_ROLE_KEY", settings.SUPABASE_SERVICE_ROLE_KEY),
            ("SUPABASE_STORAGE_BUCKET", settings.SUPABASE_STORAGE_BUCKET),
        ]
        if not val
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Storage not configured. Missing env vars: {', '.join(missing)}",
        )


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}"}


class StorageService:
    @staticmethod
    async def upload(
        path: str,
        content: bytes,
        content_type: str,
        upsert: bool = True,
    ) -> str:
        """
        Upload bytes to `<bucket>/<path>`. Returns the storage path (e.g.
        "kyc-media/sessions/12/video.webm") which we store on the DB row.

        Use `create_signed_url(path)` to hand a time-limited URL to the frontend.
        """
        _require_creds()
        bucket = settings.SUPABASE_STORAGE_BUCKET
        url = f"{settings.SUPABASE_URL}/storage/v1/object/{bucket}/{path}"
        headers = {
            **_auth_headers(),
            "Content-Type": content_type,
            "x-upsert": "true" if upsert else "false",
        }
        try:
            async with httpx.AsyncClient(timeout=80.0) as client:
                r = await client.post(url, headers=headers, content=content)
        except httpx.HTTPError as e:
            
            logger.exception(f"Storage upload network error: "
                             f"type={type(e).__name__}, "
                             f"message={str(e)!r}"
                             )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Storage upload failed (network).",
            )

        if r.status_code not in (200, 201):
            logger.error(f"Storage upload failed: {r.status_code} {r.text[:300]}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Storage upload failed ({r.status_code}).",
            )

        logger.info(f"Stored {len(content)} bytes at {bucket}/{path}")
        return f"{bucket}/{path}"

    @staticmethod
    async def download(path_in_bucket: str) -> bytes:
        """
        Fetch the raw bytes of an object from the private bucket.
        `path_in_bucket` may be "<bucket>/<path>" or just "<path>".
        """
        _require_creds()
        bucket = settings.SUPABASE_STORAGE_BUCKET
        if path_in_bucket.startswith(f"{bucket}/"):
            path_in_bucket = path_in_bucket[len(bucket) + 1:]
        url = f"{settings.SUPABASE_URL}/storage/v1/object/{bucket}/{path_in_bucket}"
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.get(url, headers=_auth_headers())
        except httpx.HTTPError as e:
            logger.error(f"Storage download network error: {e}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Storage download failed (network).",
            )
        if r.status_code != 200:
            logger.error(f"Storage download failed: {r.status_code} {r.text[:300]}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Storage download failed ({r.status_code}).",
            )
        return r.content

    @staticmethod
    async def create_signed_url(path_in_bucket: str, expires_in_seconds: int = 3600) -> str:
        """
        Return a time-limited URL the frontend can use to GET a private object.

        `path_in_bucket` is the path *inside* the bucket, NOT including the bucket name.
        If you stored "kyc-media/sessions/12/video.webm", pass "sessions/12/video.webm" here.
        """
        _require_creds()
        bucket = settings.SUPABASE_STORAGE_BUCKET

        # Tolerate either "<bucket>/<path>" or "<path>" being passed in.
        if path_in_bucket.startswith(f"{bucket}/"):
            path_in_bucket = path_in_bucket[len(bucket) + 1:]

        url = f"{settings.SUPABASE_URL}/storage/v1/object/sign/{bucket}/{path_in_bucket}"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(
                    url, headers=_auth_headers(), json={"expiresIn": expires_in_seconds}
                )
        except httpx.HTTPError as e:
            logger.error(f"Signed URL network error: {e}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not create signed URL (network).",
            )

        if r.status_code != 200:
            logger.error(f"Signed URL failed: {r.status_code} {r.text[:300]}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Could not create signed URL ({r.status_code}).",
            )

        data = r.json()
        signed = data.get("signedURL") or data.get("signedUrl")
        if not signed:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Signed URL response missing signedURL.",
            )
        return f"{settings.SUPABASE_URL}/storage/v1{signed}"
