from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from ..map_search import nearby_places, search_places
from ..schemas import MapNearbyRequest, MapSearchRequest

router = APIRouter()


@router.post("/api/map/search")
async def map_search_handler(payload: MapSearchRequest):
    try:
        return await search_places(payload.query, payload.limit)
    except Exception as exc:  # noqa: BLE001 - 前端期待 {error}
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"error": str(exc)})


@router.post("/api/map/nearby")
async def map_nearby_handler(payload: MapNearbyRequest):
    try:
        return await nearby_places(payload.lat, payload.lon, payload.limit)
    except Exception as exc:  # noqa: BLE001 - 前端期待 {error}
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"error": str(exc)})
