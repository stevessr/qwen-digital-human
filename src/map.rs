use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct NominatimPlace {
    place_id: Option<u64>,
    osm_type: Option<String>,
    osm_id: Option<u64>,
    lat: String,
    lon: String,
    display_name: String,
    boundingbox: Option<Vec<String>>,
    category: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    importance: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MapBounds {
    pub south: f64,
    pub north: f64,
    pub west: f64,
    pub east: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MapPlace {
    pub place_id: Option<u64>,
    pub osm_type: Option<String>,
    pub osm_id: Option<u64>,
    pub display_name: String,
    pub lat: f64,
    pub lon: f64,
    pub bounds: MapBounds,
    pub category: Option<String>,
    pub kind: Option<String>,
    pub importance: Option<f64>,
    pub map_url: String,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct MapSearchResponse {
    pub query: String,
    pub results: Vec<MapPlace>,
}

pub async fn search_places(query: &str, limit: usize) -> anyhow::Result<MapSearchResponse> {
    let trimmed = query.trim();
    anyhow::ensure!(!trimmed.is_empty(), "地图搜索关键词不能为空");

    let client = reqwest::Client::builder()
        .user_agent("qwen-digital-human/1.0 (map-search)")
        .build()?;

    let limit = limit.clamp(1, 8).to_string();
    let response = client
        .get("https://nominatim.openstreetmap.org/search")
        .query(&[
            ("format", "jsonv2"),
            ("addressdetails", "1"),
            ("extratags", "1"),
            ("namedetails", "1"),
            ("limit", limit.as_str()),
            ("q", trimmed),
        ])
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(anyhow::anyhow!("地图搜索失败: HTTP {} - {}", status, body));
    }

    let raw: Vec<NominatimPlace> = serde_json::from_str(&body)
        .map_err(|err| anyhow::anyhow!("地图搜索结果解析失败: {} | body={}", err, body))?;

    let results = raw
        .into_iter()
        .map(|place| to_map_place(&place))
        .collect::<Vec<_>>();

    Ok(MapSearchResponse {
        query: trimmed.to_string(),
        results,
    })
}

#[allow(dead_code)]
pub fn default_place() -> MapPlace {
    let lat = 39.9087;
    let lon = 116.3975;
    let bounds = MapBounds {
        south: 39.8937,
        north: 39.9237,
        west: 116.3775,
        east: 116.4175,
    };
    build_map_place(
        Some(1),
        None,
        None,
        "北京天安门广场（默认讲解中心）".to_string(),
        lat,
        lon,
        bounds,
        Some("tourist_attraction".to_string()),
        Some("default".to_string()),
        Some(1.0),
    )
}

#[allow(dead_code)]
pub fn build_map_context(place: &MapPlace) -> String {
    format!(
        "【地图讲解上下文】\n\
         地点：{}\n\
         坐标：{:.6}, {:.6}\n\
         类型：{}\n\
         讲解要求：请以地图数字人讲解员的口吻，优先说明该地点的地理位置、周边地标、交通到达方式、适合人群与游览建议；语言简洁、自然、专业。\n\
         如果用户继续追问，请围绕当前地点继续讲解，不要偏离地图主题。",
        place.display_name,
        place.lat,
        place.lon,
        place.kind.as_deref().unwrap_or("unknown"),
    )
}

fn to_map_place(place: &NominatimPlace) -> MapPlace {
    let lat = place.lat.parse::<f64>().unwrap_or_default();
    let lon = place.lon.parse::<f64>().unwrap_or_default();
    let bounds = parse_bounds(place.boundingbox.as_deref(), lat, lon);
    build_map_place(
        place.place_id,
        place.osm_type.clone(),
        place.osm_id,
        place.display_name.clone(),
        lat,
        lon,
        bounds,
        place.category.clone(),
        place.kind.clone(),
        place.importance,
    )
}

fn build_map_place(
    place_id: Option<u64>,
    osm_type: Option<String>,
    osm_id: Option<u64>,
    display_name: String,
    lat: f64,
    lon: f64,
    bounds: MapBounds,
    category: Option<String>,
    kind: Option<String>,
    importance: Option<f64>,
) -> MapPlace {
    let map_url = build_embed_url(lat, lon, &bounds);
    let summary = build_summary(&display_name, lat, lon, &category, &kind, importance);

    MapPlace {
        place_id,
        osm_type,
        osm_id,
        display_name,
        lat,
        lon,
        bounds,
        category,
        kind,
        importance,
        map_url,
        summary,
    }
}

fn build_summary(
    display_name: &str,
    lat: f64,
    lon: f64,
    category: &Option<String>,
    kind: &Option<String>,
    importance: Option<f64>,
) -> String {
    let mut lines = Vec::new();
    lines.push(display_name.to_string());
    lines.push(format!("坐标：{:.6}, {:.6}", lat, lon));
    if let Some(category) = category.as_deref() {
        lines.push(format!("分类：{}", category));
    }
    if let Some(kind) = kind.as_deref() {
        lines.push(format!("类型：{}", kind));
    }
    if let Some(importance) = importance {
        lines.push(format!("重要度：{:.3}", importance));
    }
    lines.join("\n")
}

fn parse_bounds(raw: Option<&[String]>, lat: f64, lon: f64) -> MapBounds {
    if let Some(values) = raw {
        if values.len() == 4 {
            let south = values[0].parse::<f64>().unwrap_or(lat - 0.01);
            let north = values[1].parse::<f64>().unwrap_or(lat + 0.01);
            let west = values[2].parse::<f64>().unwrap_or(lon - 0.01);
            let east = values[3].parse::<f64>().unwrap_or(lon + 0.01);
            return MapBounds { south, north, west, east };
        }
    }

    MapBounds {
        south: lat - 0.01,
        north: lat + 0.01,
        west: lon - 0.01,
        east: lon + 0.01,
    }
}

fn build_embed_url(lat: f64, lon: f64, bounds: &MapBounds) -> String {
    format!(
        "https://www.openstreetmap.org/export/embed.html?bbox={west}%2C{south}%2C{east}%2C{north}&layer=mapnik&marker={lat}%2C{lon}",
        west = bounds.west,
        south = bounds.south,
        east = bounds.east,
        north = bounds.north,
        lat = lat,
        lon = lon,
    )
}
