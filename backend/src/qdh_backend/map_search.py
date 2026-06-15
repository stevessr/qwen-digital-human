from __future__ import annotations

import asyncio
from difflib import SequenceMatcher
from math import asin, cos, radians, sin, sqrt

import httpx

from .schemas import MapBounds, MapPlace, MapSearchResponse

NEARBY_RADIUS_METERS = 1000
MAX_NEARBY_RESULTS = 10
OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter"

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
    distance_m: float | None = None,
) -> str:
    lines = [display_name, f"坐标：{lat:.6f}, {lon:.6f}"]
    if distance_m is not None:
        lines.append(f"距离：{distance_m:.0f} 米")
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


def _nearby_probe_points(lat: float, lon: float, limit: int) -> list[tuple[float, float]]:
    offsets = (
        (0.0, 0.0),
        (0.0018, 0.0),
        (0.0, 0.0022),
        (-0.0018, 0.0),
        (0.0, -0.0022),
        (0.0013, 0.0016),
        (0.0013, -0.0016),
        (-0.0013, 0.0016),
        (-0.0013, -0.0016),
    )
    return [(lat + d_lat, lon + d_lon) for d_lat, d_lon in offsets[: max(1, limit + 2)]]


def _is_useful_place_name(name: str) -> bool:
    stripped = name.strip()
    return bool(stripped) and any(char.isalpha() for char in stripped)


def _place_key(place: MapPlace) -> str:
    return place.display_name.casefold().strip()


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_m = 6_371_000
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    r_lat1 = radians(lat1)
    r_lat2 = radians(lat2)
    hav = sin(d_lat / 2) ** 2 + cos(r_lat1) * cos(r_lat2) * sin(d_lon / 2) ** 2
    return 2 * earth_radius_m * asin(sqrt(hav))


def _normalise_nearby_results(
    places: list[MapPlace],
    origin_lat: float,
    origin_lon: float,
    limit: int,
) -> list[MapPlace]:
    seen: set[str] = set()
    unique: list[MapPlace] = []
    for place in places:
        if not _is_useful_place_name(place.display_name):
            continue
        distance = place.distance_m
        if distance is None:
            distance = _distance_m(origin_lat, origin_lon, place.lat, place.lon)
            place.distance_m = distance
        if distance > NEARBY_RADIUS_METERS:
            continue
        key = _place_key(place)
        if key in seen:
            continue
        seen.add(key)
        unique.append(place)

    unique.sort(key=lambda item: (item.distance_m if item.distance_m is not None else 10**9))
    return unique[:limit]


def _overpass_query(lat: float, lon: float) -> str:
    return f"""
[out:json][timeout:8];
(
  node(around:{NEARBY_RADIUS_METERS},{lat:.7f},{lon:.7f})["name"];
  way(around:{NEARBY_RADIUS_METERS},{lat:.7f},{lon:.7f})["name"];
  relation(around:{NEARBY_RADIUS_METERS},{lat:.7f},{lon:.7f})["name"];
);
out center 80;
"""


def _tag_category(tags: dict[str, object]) -> tuple[str | None, str | None]:
    for key in (
        "tourism",
        "historic",
        "amenity",
        "leisure",
        "shop",
        "public_transport",
        "railway",
        "highway",
        "office",
        "building",
        "natural",
    ):
        value = tags.get(key)
        if isinstance(value, str) and value.strip():
            return key, value
    return None, None


def _overpass_to_place(raw: dict, origin_lat: float, origin_lon: float) -> MapPlace | None:
    tags = raw.get("tags") if isinstance(raw.get("tags"), dict) else {}
    name = (
        str(tags.get("name:zh") or tags.get("name:en") or tags.get("name") or "").strip()
        if isinstance(tags, dict)
        else ""
    )
    if not name:
        return None

    raw_lat = raw.get("lat")
    raw_lon = raw.get("lon")
    center = raw.get("center") if isinstance(raw.get("center"), dict) else {}
    lat = raw_lat if raw_lat is not None else center.get("lat")
    lon = raw_lon if raw_lon is not None else center.get("lon")
    try:
        place_lat = float(lat)
        place_lon = float(lon)
    except (TypeError, ValueError):
        return None

    distance_m = _distance_m(origin_lat, origin_lon, place_lat, place_lon)
    if distance_m > NEARBY_RADIUS_METERS:
        return None

    category, kind = _tag_category(tags if isinstance(tags, dict) else {})
    bounds = MapBounds(
        south=place_lat - 0.003,
        north=place_lat + 0.003,
        west=place_lon - 0.004,
        east=place_lon + 0.004,
    )
    return MapPlace(
        place_id=None,
        osm_type=str(raw.get("type") or ""),
        osm_id=raw.get("id"),
        display_name=name,
        lat=place_lat,
        lon=place_lon,
        bounds=bounds,
        category=category,
        kind=kind,
        importance=None,
        distance_m=distance_m,
        map_url=_build_embed_url(place_lat, place_lon, bounds),
        summary=_build_summary(name, place_lat, place_lon, category, kind, None, distance_m),
    )


async def _overpass_nearby_places(
    client: httpx.AsyncClient,
    lat: float,
    lon: float,
) -> list[MapPlace]:
    response = await client.post(OVERPASS_ENDPOINT, data={"data": _overpass_query(lat, lon)})
    response.raise_for_status()
    data = response.json()
    elements = data.get("elements") if isinstance(data, dict) else []
    if not isinstance(elements, list):
        return []
    places: list[MapPlace] = []
    for raw in elements:
        if not isinstance(raw, dict):
            continue
        place = _overpass_to_place(raw, lat, lon)
        if place is not None:
            places.append(place)
    return places


async def _reverse_place(
    client: httpx.AsyncClient,
    lat: float,
    lon: float,
    origin_lat: float,
    origin_lon: float,
) -> MapPlace | None:
    response = await client.get(
        "https://nominatim.openstreetmap.org/reverse",
        params={
            "format": "jsonv2",
            "addressdetails": "1",
            "extratags": "1",
            "namedetails": "1",
            "zoom": "18",
            "lat": f"{lat:.7f}",
            "lon": f"{lon:.7f}",
        },
    )
    if not response.is_success:
        return None
    raw = response.json()
    if raw.get("error"):
        return None
    return _to_place(raw, origin=(origin_lat, origin_lon))


def _to_place(raw: dict, origin: tuple[float, float] | None = None) -> MapPlace:
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
    distance_m = None
    if origin is not None:
        distance_m = _distance_m(origin[0], origin[1], lat, lon)
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
        distance_m=distance_m,
        map_url=_build_embed_url(lat, lon, bounds),
        summary=_build_summary(display_name, lat, lon, category, kind, importance, distance_m),
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


async def nearby_places(lat: float, lon: float, limit: int = MAX_NEARBY_RESULTS) -> MapSearchResponse:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("手动标点坐标超出地图范围")

    limit = max(1, min(MAX_NEARBY_RESULTS, int(limit or MAX_NEARBY_RESULTS)))
    query = f"{lat:.6f},{lon:.6f}"

    overpass_places: list[MapPlace] = []
    try:
        async with httpx.AsyncClient(
            timeout=10,
            headers={"User-Agent": "qwen-digital-human/1.0 (map-nearby)"},
        ) as client:
            overpass_places = await _overpass_nearby_places(client, lat, lon)
    except Exception:
        overpass_places = []

    places = _normalise_nearby_results(overpass_places, lat, lon, limit)
    if places:
        return MapSearchResponse(query=query, results=places)

    reverse_places: list[MapPlace] = []
    try:
        async with httpx.AsyncClient(
            timeout=4,
            headers={"User-Agent": "qwen-digital-human/1.0 (map-nearby-fallback)"},
        ) as client:
            responses = await asyncio.gather(
                *(
                    _reverse_place(client, probe_lat, probe_lon, lat, lon)
                    for probe_lat, probe_lon in _nearby_probe_points(lat, lon, limit)
                )
            )
            reverse_places = [place for place in responses if place is not None]
    except Exception:
        reverse_places = []

    return MapSearchResponse(
        query=query,
        results=_normalise_nearby_results(reverse_places, lat, lon, limit),
    )
