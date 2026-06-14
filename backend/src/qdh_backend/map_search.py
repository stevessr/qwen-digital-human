from __future__ import annotations

import httpx

from .schemas import MapBounds, MapPlace, MapSearchResponse


def _parse_bounds(raw: list[str] | None, lat: float, lon: float) -> MapBounds:
    if raw and len(raw) == 4:
        try:
            return MapBounds(
                south=float(raw[0]),
                north=float(raw[1]),
                west=float(raw[2]),
                east=float(raw[3]),
            )
        except ValueError:
            pass
    return MapBounds(south=lat - 0.01, north=lat + 0.01, west=lon - 0.01, east=lon + 0.01)


def _build_embed_url(lat: float, lon: float, bounds: MapBounds) -> str:
    return (
        "https://www.openstreetmap.org/export/embed.html"
        f"?bbox={bounds.west}%2C{bounds.south}%2C{bounds.east}%2C{bounds.north}"
        f"&layer=mapnik&marker={lat}%2C{lon}"
    )


def _build_summary(
    display_name: str,
    lat: float,
    lon: float,
    category: str | None,
    kind: str | None,
    importance: float | None,
) -> str:
    lines = [display_name, f"坐标：{lat:.6f}, {lon:.6f}"]
    if category:
        lines.append(f"分类：{category}")
    if kind:
        lines.append(f"类型：{kind}")
    if importance is not None:
        lines.append(f"重要度：{importance:.3f}")
    return "\n".join(lines)


def _to_place(raw: dict) -> MapPlace:
    try:
        lat = float(raw.get("lat") or 0.0)
        lon = float(raw.get("lon") or 0.0)
    except ValueError:
        lat = 0.0
        lon = 0.0
    bounds = _parse_bounds(raw.get("boundingbox"), lat, lon)
    category = raw.get("category")
    kind = raw.get("type")
    importance = raw.get("importance")
    if importance is not None:
        try:
            importance = float(importance)
        except (TypeError, ValueError):
            importance = None
    display_name = str(raw.get("display_name") or "")
    return MapPlace(
        place_id=raw.get("place_id"),
        osm_type=raw.get("osm_type"),
        osm_id=raw.get("osm_id"),
        display_name=display_name,
        lat=lat,
        lon=lon,
        bounds=bounds,
        category=category,
        kind=kind,
        importance=importance,
        map_url=_build_embed_url(lat, lon, bounds),
        summary=_build_summary(display_name, lat, lon, category, kind, importance),
    )


async def search_places(query: str, limit: int = 5) -> MapSearchResponse:
    trimmed = query.strip()
    if not trimmed:
        raise ValueError("地图搜索关键词不能为空")
    limit = max(1, min(8, int(limit or 5)))
    async with httpx.AsyncClient(
        timeout=20,
        headers={"User-Agent": "qwen-digital-human/1.0 (map-search)"},
    ) as client:
        response = await client.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "format": "jsonv2",
                "addressdetails": "1",
                "extratags": "1",
                "namedetails": "1",
                "limit": str(limit),
                "q": trimmed,
            },
        )
    if not response.is_success:
        raise RuntimeError(f"地图搜索失败: HTTP {response.status_code} - {response.text}")
    raw_results = response.json()
    return MapSearchResponse(query=trimmed, results=[_to_place(item) for item in raw_results])
