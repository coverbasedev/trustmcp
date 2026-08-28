from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from ..deps import get_storage
from ..ratelimit import rate_limit
from ..storage import Storage

router = APIRouter(prefix="/v1/files", tags=["files"])


@router.get("", dependencies=[Depends(rate_limit("files"))])
def serve_local_file(token: str = Query(...), storage: Storage = Depends(get_storage)):
    """Serves locally-stored artifacts via short-lived signed tokens. When S3 is
    configured this endpoint is unused (presigned S3 URLs are returned instead)."""
    try:
        storage_key = storage.verify_local(token)
    except ValueError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"invalid token: {e}") from e
    try:
        data = storage.read_local(storage_key)
    except FileNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found") from e
    return Response(content=data, media_type="application/octet-stream")
