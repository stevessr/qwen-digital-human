from __future__ import annotations

from difflib import SequenceMatcher

import httpx

from .schemas import MapBounds, MapPlace, MapSearchResponse

LOCAL_PLACES: tuple[dict[str, object], ...] = (
    {
        "display_name": "北京天安门广场",
        "lat": 39.9087,
        "lon": 116.3975,
        "bounds": [39.8937, 39.9237, 116.3775, 116.4175],
        "category": "tourism",
        "kind": "square",
        "keywords": ("北京", "天安门", "天安门广场", "广场"),
    },
    {
        "display_name": "北京故宫博物院",
        "lat": 39.9163,
        "lon": 116.3972,
        "bounds": [39.9063, 39.9263, 116.3852, 116.4092],
        "category": "tourism",
        "kind": "museum",
        "keywords": ("北京故宫", "故宫", "故宫博物院", "紫禁城"),
    },
    {
        "display_name": "上海外滩",
        "lat": 31.2400,
        "lon": 121.4900,
        "bounds": [31.2300, 31.2500, 121.4800, 121.5000],
        "category": "tourism",
        "kind": "waterfront",
        "keywords": ("上海", "外滩", "上海外滩", "黄浦江"),
    },
    {
        "display_name": "深圳湾公园",
        "lat": 22.5212,
        "lon": 113.9738,
        "bounds": [22.5012, 22.5412, 113.9538, 113.9938],
        "category": "leisure",
        "kind": "park",
        "keywords": ("深圳", "深圳湾", "深圳湾公园", "公园"),
    },
    {
        "display_name": "广州塔",
        "lat": 23.1064,
        "lon": 113.3245,
        "bounds": [23.0964, 23.1164, 113.3145, 113.3345],
        "category": "tourism",
        "kind": "attraction",
        "keywords": ("广州", "广州塔", "小蛮腰"),
    },
    {
        "display_name": "杭州西湖",
        "lat": 30.2460,
        "lon": 120.1500,
        "bounds": [30.2160, 30.2760, 120.1200, 120.1800],
        "category": "tourism",
        "kind": "lake",
        "keywords": ("杭州", "西湖", "杭州西湖"),
    },
)


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


def _local_raw_place(item: dict[str, object]) -> dict[str, object]:
    lat = float(item["lat"])
    lon = float(item["lon"])
    south, north, west, east = item["bounds"]  # type: ignore[misc]
    return {
        "display_name": item["display_name"],
        "lat": str(lat),
        "lon": str(lon),
        "boundingbox": [str(south), str(north), str(west), str(east)],
        "category": item["category"],
        "type": item["kind"],
        "importance": 1.0,
    }


def _score_local_place(query: str, item: dict[str, object]) -> float:
    normalized_query = query.casefold().strip()
    display_name = str(item["display_name"]).casefold()
    keywords = tuple(str(value).casefold() for value in item.get("keywords", ()))
    if not normalized_query:
        return 0.0
    if normalized_query in display_name or any(normalized_query in keyword for keyword in keywords):
        return 1.0
    if display_name in normalized_query or any(keyword and keyword in normalized_query for keyword in keywords):
        return 0.95
    return max(
        [SequenceMatcher(None, normalized_query, display_name).ratio()]
        + [SequenceMatcher(None, normalized_query, keyword).ratio() for keyword in keywords]
    )


def _local_results(query: str, limit: int) -> list[MapPlace]:
    scored = sorted(
        ((_score_local_place(query, item), item) for item in LOCAL_PLACES),
        key=lambda pair: pair[0],
        reverse=True,
    )
    matches = [item for score, item in scored if score >= 0.32][:limit]
    if not matches:
        matches = [LOCAL_PLACES[0]]
    return [_to_place(_local_raw_place(item)) for item in matches]


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
    try:
        async with httpx.AsyncClient(
            timeout=8,
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
        if response.is_success:
            raw_results = response.json()
            places = [_to_place(item) for item in raw_results]
            if places:
                return MapSearchResponse(query=trimmed, results=places)
    except Exception:
        # Offline/local demo environments may block public map APIs.  Fall back
        # to a small built-in gazetteer so the UI can still render and write
        # useful map context.
        pass

    return MapSearchResponse(query=trimmed, results=_local_results(trimmed, limit))
