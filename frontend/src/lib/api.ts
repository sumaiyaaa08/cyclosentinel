// Typed API client — no hardcoded storm data. All values fetched from FastAPI.
// Same-origin ("") in prod (Render serves UI+API together); localhost in dev.
export const API_BASE =
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");

export interface StormSummary {
  sid: string;
  n_points: number;
  max_wind_kt: number;
  ri_events: number;
  start_time: string;
  end_time: string;
}

export interface TrackPoint {
  ISO_TIME: string;
  LAT: number;
  LON: number;
  WIND_KT: number;
  PRES_HPA: number;
  trans_speed_kmh: number;
  bearing_deg: number;
  wind_trend_12h: number;
  pres_trend_12h: number;
  day_of_year: number;
  ri_label: number;
  future_max_wind_24h: number;
  model_ri_prob: number;
}

export interface StormTrack {
  sid: string;
  track: TrackPoint[];
}

export interface PredictInput {
  lat: number;
  lon: number;
  wind_kt: number;
  pres_hpa: number;
  trans_speed_kmh: number;
  bearing_deg: number;
  wind_trend_12h: number;
  pres_trend_12h: number;
  day_of_year: number;
}

export interface PredictOutput {
  ri_probability: number;
  ri_prediction: number;
  threshold: number;
}

export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  roc_auc: number;
  confusion_matrix: number[][];
  n_storms: number;
  n_points: number;
  ri_rate: number;
}

export interface ExplainOutput {
  ri_probability: number;
  ri_prediction: number;
  base_value: number;
  shap_values: Record<string, number>;
  feature_values: Record<string, number>;
  top_feature: string;
}

export interface LiveObs {
  sid: string;
  ISO_TIME: string;
  LAT: number;
  LON: number;
  WIND_KT: number;
  PRES_HPA: number;
  trans_speed_kmh: number;
  bearing_deg: number;
  wind_trend_12h: number;
  pres_trend_12h: number;
  day_of_year: number;
  model_ri_prob: number;
  alert: boolean;
  alert_level: "HIGH" | "WATCH" | "LOW";
  source_point_time: string;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry:
      | { type: "LineString"; coordinates: [number, number][] }
      | { type: "Polygon"; coordinates: [number, number][][] }
      | { type: "Point"; coordinates: [number, number] };
    properties: Record<string, number | string>;
  }[];
}

async function req<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  storms: (s?: AbortSignal) => req<StormSummary[]>("/api/storms", undefined, s),
  storm: (sid: string, s?: AbortSignal) =>
    req<StormTrack>(`/api/storms/${encodeURIComponent(sid)}`, undefined, s),
  predict: (body: PredictInput, s?: AbortSignal) =>
    req<PredictOutput>("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, s),
  metrics: (s?: AbortSignal) => req<ModelMetrics>("/api/model/metrics", undefined, s),
  explain: (body: PredictInput, s?: AbortSignal) =>
    req<ExplainOutput>("/api/predict/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, s),
  liveFeed: (s?: AbortSignal) => req<LiveObs>("/api/live_feed", undefined, s),
  geojson: (sid: string, s?: AbortSignal) =>
    req<GeoJSONFeatureCollection>(
      `/api/storms/${encodeURIComponent(sid)}/geojson`,
      undefined,
      s
    ),
};
