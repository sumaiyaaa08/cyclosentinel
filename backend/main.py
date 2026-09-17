"""CycloSentinel FastAPI backend — Phases 1+2.

FAIL-FAST: raises RuntimeError at startup if model/parquet missing.
In-memory: Parquet + XGBoost + SHAP TreeExplainer held in app.state.
"""
from __future__ import annotations

import json
import math
import pickle
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models"
PARQUET_PATH = MODELS_DIR / "clean_storms.parquet"
MODEL_PATH = MODELS_DIR / "ri_model.pkl"
METRICS_PATH = MODELS_DIR / "metrics.json"

FEATURES: list[str] = [
    "LAT",
    "LON",
    "WIND_KT",
    "PRES_HPA",
    "trans_speed_kmh",
    "bearing_deg",
    "wind_trend_12h",
    "pres_trend_12h",
    "day_of_year",
]


class PredictInput(BaseModel):
    lat: float = Field(..., ge=-10.0, le=40.0, description="Latitude deg N")
    lon: float = Field(..., ge=40.0, le=105.0, description="Longitude deg E")
    wind_kt: float = Field(..., ge=10.0, le=200.0)
    pres_hpa: float = Field(..., ge=850.0, le=1020.0)
    trans_speed_kmh: float = Field(..., ge=0.0, le=80.0)
    bearing_deg: float = Field(..., ge=0.0, le=360.0)
    wind_trend_12h: float = Field(..., ge=-60.0, le=60.0)
    pres_trend_12h: float = Field(..., ge=-30.0, le=30.0)
    day_of_year: int = Field(..., ge=1, le=366)

    def to_feature_row(self) -> list[float]:
        return [
            self.lat,
            self.lon,
            self.wind_kt,
            self.pres_hpa,
            self.trans_speed_kmh,
            self.bearing_deg,
            self.wind_trend_12h,
            self.pres_trend_12h,
            float(self.day_of_year),
        ]


class PredictOutput(BaseModel):
    ri_probability: float
    ri_prediction: int
    threshold: float = 0.5
    features_used: list[str] = FEATURES


class ExplainOutput(BaseModel):
    ri_probability: float
    ri_prediction: int
    base_value: float
    shap_values: dict[str, float]
    feature_values: dict[str, float]
    top_feature: str


def _load_artifacts() -> tuple[pd.DataFrame, Any, dict]:
    if not PARQUET_PATH.exists():
        raise RuntimeError(f"FATAL: missing parquet artifact: {PARQUET_PATH}")
    if not MODEL_PATH.exists():
        raise RuntimeError(f"FATAL: missing model artifact: {MODEL_PATH}")
    if not METRICS_PATH.exists():
        raise RuntimeError(f"FATAL: missing metrics artifact: {METRICS_PATH}")
    df = pd.read_parquet(PARQUET_PATH)
    with open(MODEL_PATH, "rb") as f:
        model = pickle.load(f)
    with open(METRICS_PATH) as f:
        metrics = json.load(f)
    return df, model, metrics


@asynccontextmanager
async def lifespan(app: FastAPI):
    df, model, metrics = _load_artifacts()  # fail-fast RuntimeError propagates
    app.state.df = df
    app.state.model = model
    app.state.metrics = metrics
    app.state.explainer = None  # lazy SHAP TreeExplainer singleton
    yield


app = FastAPI(title="CycloSentinel API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_df() -> pd.DataFrame:
    df = getattr(app.state, "df", None)
    if df is None:  # fallback for TestClient without lifespan
        df, _, _ = _load_artifacts()
        app.state.df = df
    return app.state.df


def _get_model() -> Any:
    model = getattr(app.state, "model", None)
    if model is None:
        _, model, _ = _load_artifacts()
        app.state.model = model
    return app.state.model


def _get_metrics() -> dict:
    m = getattr(app.state, "metrics", None)
    if m is None:
        _, _, m = _load_artifacts()
        app.state.metrics = m
    return m  # type: ignore[return-value]


def _get_explainer() -> Any:
    expl = getattr(app.state, "explainer", None)
    if expl is None:
        import shap as _shap

        expl = _shap.TreeExplainer(_get_model())
        app.state.explainer = expl
    return expl


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/storms")
def list_storms() -> list[dict[str, Any]]:
    df = _get_df()
    out: list[dict[str, Any]] = []
    for sid, g in df.groupby("SID"):
        g_sorted = g.sort_values("ISO_TIME")
        out.append(
            {
                "sid": str(sid),
                "n_points": int(len(g_sorted)),
                "max_wind_kt": float(g_sorted["WIND_KT"].max()),
                "ri_events": int(g_sorted["ri_label"].sum()),
                "start_time": str(g_sorted["ISO_TIME"].iloc[0]),
                "end_time": str(g_sorted["ISO_TIME"].iloc[-1]),
            }
        )
    return sorted(out, key=lambda r: r["sid"])


@app.get("/api/storms/{sid}")
def get_storm(sid: str) -> dict[str, Any]:
    df = _get_df()
    model = _get_model()
    g = df[df["SID"] == sid].sort_values("ISO_TIME")
    if g.empty:
        raise HTTPException(status_code=404, detail=f"Storm {sid} not found")
    X = g[FEATURES].to_numpy(dtype=float)
    proba = model.predict_proba(X)[:, 1]
    track: list[dict[str, Any]] = []
    for (_, row), p in zip(g.iterrows(), proba):
        track.append(
            {
                "ISO_TIME": str(row["ISO_TIME"]),
                "LAT": float(row["LAT"]),
                "LON": float(row["LON"]),
                "WIND_KT": float(row["WIND_KT"]),
                "PRES_HPA": float(row["PRES_HPA"]),
                "trans_speed_kmh": float(row["trans_speed_kmh"]),
                "bearing_deg": float(row["bearing_deg"]),
                "wind_trend_12h": float(row["wind_trend_12h"]),
                "pres_trend_12h": float(row["pres_trend_12h"]),
                "day_of_year": int(row["day_of_year"]),
                "ri_label": int(row["ri_label"]),
                "future_max_wind_24h": float(row["future_max_wind_24h"]),
                "model_ri_prob": float(p),
            }
        )
    return {"sid": sid, "track": track}


@app.post("/api/predict", response_model=PredictOutput)
def predict(inp: PredictInput) -> PredictOutput:
    model = _get_model()
    proba = float(model.predict_proba([inp.to_feature_row()])[0, 1])
    return PredictOutput(
        ri_probability=proba,
        ri_prediction=int(proba >= 0.5),
    )


@app.get("/api/model/metrics")
def model_metrics() -> dict[str, Any]:
    return _get_metrics()


@app.post("/api/predict/explain", response_model=ExplainOutput)
def predict_explain(inp: PredictInput) -> ExplainOutput:
    import numpy as _np

    model = _get_model()
    explainer = _get_explainer()
    row = _np.array([inp.to_feature_row()], dtype=float)
    proba = float(model.predict_proba(row)[0, 1])
    sv = explainer.shap_values(row)
    arr = _np.asarray(sv)
    if arr.ndim == 3:  # some shap versions return (n, f, classes)
        arr = arr[:, :, -1]
    vals = arr[0].tolist()
    try:
        base = explainer.expected_value
        base_f = float(_np.asarray(base).ravel()[-1])
    except Exception:
        base_f = 0.0
    shap_map = {f: float(v) for f, v in zip(FEATURES, vals)}
    feat_map = {f: float(v) for f, v in zip(FEATURES, row[0].tolist())}
    top = max(shap_map, key=lambda k: abs(shap_map[k]))
    return ExplainOutput(
        ri_probability=proba,
        ri_prediction=int(proba >= 0.5),
        base_value=base_f,
        shap_values=shap_map,
        feature_values=feat_map,
        top_feature=top,
    )


@app.get("/api/live_feed")
def live_feed() -> dict[str, Any]:
    rng = np.random.default_rng()
    df = _get_df()
    model = _get_model()
    sids = df["SID"].unique()
    sid = str(rng.choice(sids))
    g = df[df["SID"] == sid].sort_values("ISO_TIME")
    idx = int(rng.integers(max(0, len(g) - 8), len(g)))
    base = g.iloc[idx]
    # jitter to simulate a fresh observation
    wind = float(np.clip(base["WIND_KT"] + rng.normal(0, 2.5), 15.0, 140.0))
    pres = float(np.clip(base["PRES_HPA"] + rng.normal(0, 1.5), 900.0, 1012.0))
    lat = float(np.clip(base["LAT"] + rng.normal(0, 0.15), 3.0, 28.0))
    lon = float(np.clip(base["LON"] + rng.normal(0, 0.15), 45.0, 100.0))
    feat = [
        lat, lon, wind, pres,
        float(base["trans_speed_kmh"]),
        float(base["bearing_deg"]),
        float(base["wind_trend_12h"]),
        float(base["pres_trend_12h"]),
        int(base["day_of_year"]),
    ]
    proba = float(model.predict_proba([feat])[0, 1])
    alert = proba >= 0.5
    level = "HIGH" if proba >= 0.5 else ("WATCH" if proba >= 0.3 else "LOW")
    return {
        "sid": sid,
        "ISO_TIME": datetime.now(timezone.utc).isoformat(),
        "LAT": lat,
        "LON": lon,
        "WIND_KT": wind,
        "PRES_HPA": pres,
        "trans_speed_kmh": float(base["trans_speed_kmh"]),
        "bearing_deg": float(base["bearing_deg"]),
        "wind_trend_12h": float(base["wind_trend_12h"]),
        "pres_trend_12h": float(base["pres_trend_12h"]),
        "day_of_year": int(base["day_of_year"]),
        "model_ri_prob": proba,
        "alert": alert,
        "alert_level": level,
        "source_point_time": str(base["ISO_TIME"]),
    }


def _dest_point(lat: float, lon: float, bearing_deg: float, dist_km: float) -> tuple[float, float]:
    r = 6371.0
    d = dist_km / r
    br = math.radians(bearing_deg)
    lat1, lon1 = math.radians(lat), math.radians(lon)
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(br))
    lon2 = lon1 + math.atan2(
        math.sin(br) * math.sin(d) * math.cos(lat1),
        math.cos(d) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), ((math.degrees(lon2) + 540.0) % 360.0) - 180.0


def _cone_polygon(lat0: float, lon0: float, bearing: float) -> list[list[float]]:
    dists = [0.0, 300.0, 600.0, 900.0]
    halfs = [20.0, 70.0, 120.0, 180.0]
    left: list[list[float]] = []
    right: list[list[float]] = []
    for d, h in zip(dists, halfs):
        clat, clon = _dest_point(lat0, lon0, bearing, d)
        llat, llon = _dest_point(clat, clon, (bearing - 90.0) % 360.0, h)
        rlat, rlon = _dest_point(clat, clon, (bearing + 90.0) % 360.0, h)
        left.append([llon, llat])
        right.append([rlon, rlat])
    ring = left + right[::-1] + [left[0]]
    return ring


@app.get("/api/storms/{sid}/geojson")
def storm_geojson(sid: str) -> dict[str, Any]:
    df = _get_df()
    model = _get_model()
    g = df[df["SID"] == sid].sort_values("ISO_TIME")
    if g.empty:
        raise HTTPException(status_code=404, detail=f"Storm {sid} not found")
    X = g[FEATURES].to_numpy(dtype=float)
    proba = model.predict_proba(X)[:, 1]
    coords: list[list[float]] = []
    point_features: list[dict[str, Any]] = []
    for (_, row), p in zip(g.iterrows(), proba):
        lon, lat = float(row["LON"]), float(row["LAT"])
        coords.append([lon, lat])
        point_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "sid": sid,
                    "ISO_TIME": str(row["ISO_TIME"]),
                    "WIND_KT": float(row["WIND_KT"]),
                    "model_ri_prob": float(p),
                },
            }
        )
    last = g.iloc[-1]
    bearing = float(last["bearing_deg"]) if float(last["bearing_deg"]) else 330.0
    ring = _cone_polygon(float(last["LAT"]), float(last["LON"]), bearing)
    features: list[dict[str, Any]] = [
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"sid": sid, "kind": "best_track"},
        },
        {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {
                "sid": sid,
                "kind": "cone_of_uncertainty_mock",
                "bearing_deg": bearing,
            },
        },
        *point_features,
    ]
    return {"type": "FeatureCollection", "features": features}


# Single-container deploy: serve Vite build if present (mounted last so /api/* wins).
_DIST = BASE_DIR / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="frontend")
