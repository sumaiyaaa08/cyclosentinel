"""CycloSentinel Phase 0: synthesize NIO best-track data + train RI classifier.

Generates IBTrACS-like North Indian Ocean tracks, engineers operational
features, trains XGBoost for ri_label (30 kt / 24h RI), exports:
  models/clean_storms.parquet
  models/ri_model.pkl
  models/metrics.json
"""
from __future__ import annotations

import json
import pickle
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

MODELS_DIR = Path(__file__).parent / "models"
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
TARGET = "ri_label"
RI_THRESHOLD_KT = 30.0
RNG_SEED = 42


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = np.radians(lat2 - lat1)
    dl = np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return float(2 * r * np.arcsin(np.sqrt(a)))


def initial_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(lon2 - lon1)
    x = np.sin(dl) * np.cos(p2)
    y = np.cos(p1) * np.sin(p2) - np.sin(p1) * np.cos(p2) * np.cos(dl)
    return float((np.degrees(np.arctan2(x, y)) + 360.0) % 360.0)


def sample_onset_date(rng: np.random.Generator) -> datetime:
    """Weighted NIO seasonality: post-monsoon (Oct-Nov) + pre-monsoon (Apr-Jun)."""
    year = int(rng.integers(2010, 2025))
    u = rng.random()
    if u < 0.45:
        month, day = (10 if rng.random() < 0.5 else 11), int(rng.integers(1, 29))
    elif u < 0.70:
        month = int(rng.choice([4, 5, 6]))
        day = int(rng.integers(1, 29))
    elif u < 0.85:
        month, day = 12, int(rng.integers(1, 29))
    else:
        month, day = int(rng.integers(1, 13)), int(rng.integers(1, 29))
    # clamp invalid Feb 30 etc.
    try:
        return datetime(year, month, day, 0, 0, 0)
    except ValueError:
        return datetime(year, month, 28, 0, 0, 0)


def synthesize_one_storm(sid: str, rng: np.random.Generator) -> pd.DataFrame:
    basin_bob = rng.random() < 0.68  # Bay of Bengal dominant
    if basin_bob:
        lat = float(rng.uniform(6.0, 14.0))
        lon = float(rng.uniform(82.0, 92.0))
        bearing = float(rng.uniform(300.0, 350.0))  # climatological NW
    else:
        lat = float(rng.uniform(7.0, 15.0))
        lon = float(rng.uniform(55.0, 68.0))
        bearing = float(rng.uniform(290.0, 340.0))

    n_pts = int(rng.integers(28, 57))  # 7-14 days at 6h
    peak_idx = int(rng.integers(int(n_pts * 0.38), int(n_pts * 0.68)))
    peak_wind = float(rng.choice(
        [rng.uniform(40, 65), rng.uniform(65, 90), rng.uniform(90, 130)],
        p=[0.40, 0.38, 0.22],
    ))
    start_wind = float(rng.uniform(20.0, 32.0))
    start_time = sample_onset_date(rng)

    # --- intensity deltas (kt per 6h) with injected RI bursts ---
    deltas = np.zeros(n_pts)
    ri_episodes: list[int] = []
    n_epi = 1 if rng.random() < 0.55 else (2 if rng.random() < 0.30 else 0)
    for _ in range(n_epi):
        s = int(rng.integers(3, max(4, peak_idx - 5)))
        ri_episodes.append(s)
    ri_mask = np.zeros(n_pts, dtype=bool)
    for s in ri_episodes:
        ri_mask[s : s + 4] = True

    for t in range(n_pts):
        if t == 0:
            deltas[t] = 0.0
        elif t <= peak_idx:
            if ri_mask[t]:
                deltas[t] = float(rng.normal(9.0, 1.6))  # ~36kt/24h
            else:
                # stronger background so non-RI still intensifies
                deltas[t] = float(rng.normal(2.6, 2.8))
        else:
            # decay / landfall
            decay_mean = -3.2 if t > peak_idx + 6 else -2.0
            deltas[t] = float(rng.normal(decay_mean, 3.0))

    winds = np.zeros(n_pts)
    winds[0] = start_wind
    for t in range(1, n_pts):
        winds[t] = float(np.clip(winds[t - 1] + deltas[t], 15.0, 140.0))
    # rescale pre-peak to honor sampled peak (keeps RI slopes proportional)
    actual_peak = winds[: peak_idx + 1].max()
    if actual_peak > 5:
        scale = peak_wind / actual_peak
        scale = float(np.clip(scale, 0.7, 1.6))
        winds[: peak_idx + 1] *= scale
        winds = np.clip(winds, 15.0, 140.0)

    # --- motion ---
    lats = np.zeros(n_pts)
    lons = np.zeros(n_pts)
    lats[0], lons[0] = lat, lon
    speed = float(rng.uniform(10.0, 20.0))
    for t in range(1, n_pts):
        bearing = (bearing + float(rng.normal(0, 14))) % 360.0
        # recurvature: BoB storms often turn NE after ~60% life
        if basin_bob and t > int(n_pts * 0.55) and rng.random() < 0.25:
            bearing = (bearing + float(rng.uniform(20, 60))) % 360.0
        speed = float(np.clip(speed + rng.normal(0, 2.5), 5.0, 32.0))
        dist = speed * 6.0  # 6-hourly displacement
        dlat = dist * np.cos(np.radians(bearing)) / 111.19
        cos_lat = max(0.2, np.cos(np.radians(lats[t - 1])))
        dlon = dist * np.sin(np.radians(bearing)) / (111.19 * cos_lat)
        lats[t] = float(np.clip(lats[t - 1] + dlat, 3.0, 28.0))
        lons[t] = float(np.clip(lons[t - 1] + dlon, 45.0, 100.0))

    # --- pressure via NIO wind-pressure relationship ---
    pres = 1010.0 - 0.65 * winds + rng.normal(0, 2.0, n_pts)
    pres = np.clip(pres, 900.0, 1012.0)

    times = [start_time + timedelta(hours=6 * t) for t in range(n_pts)]

    df = pd.DataFrame(
        {
            "SID": sid,
            "ISO_TIME": [t.isoformat() for t in times],
            "LAT": np.round(lats, 3),
            "LON": np.round(lons, 3),
            "WIND_KT": np.round(winds, 1),
            "PRES_HPA": np.round(pres, 1),
            "_time": times,
        }
    )
    # motion features from positions (self-consistent)
    t_speed: list[float] = []
    bearings: list[float] = []
    for t in range(n_pts):
        if t == 0:
            t_speed.append(np.nan)
            bearings.append(0.0)
        else:
            d = haversine_km(lats[t - 1], lons[t - 1], lats[t], lons[t])
            t_speed.append(d / 6.0)
            bearings.append(initial_bearing_deg(lats[t - 1], lons[t - 1], lats[t], lons[t]))
    df["trans_speed_kmh"] = pd.Series(t_speed).fillna(pd.Series(t_speed).median()).round(2)
    df["bearing_deg"] = np.round(bearings, 1)
    df["wind_trend_12h"] = df["WIND_KT"].diff(2).fillna(0.0).round(1)
    df["pres_trend_12h"] = df["PRES_HPA"].diff(2).fillna(0.0).round(2)
    df["day_of_year"] = df["_time"].dt.dayofyear.astype(int)
    # future max 24h (next 4 x 6h steps); tail uses available future
    w = df["WIND_KT"].to_numpy()
    fut = np.array([w[t : t + 5].max() for t in range(n_pts)])
    df["future_max_wind_24h"] = np.round(fut, 1)
    df["ri_label"] = ((df["future_max_wind_24h"] - df["WIND_KT"]) >= RI_THRESHOLD_KT).astype(int)
    return df.drop(columns=["_time"])


def synthesize_storms(n_storms: int = 60, seed: int = RNG_SEED) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    frames: list[pd.DataFrame] = []
    for i in range(n_storms):
        year = int(rng.integers(2010, 2025))
        sid = f"{year}{i:03d}NIO"
        frames.append(synthesize_one_storm(sid, rng))
    df = pd.concat(frames, ignore_index=True)
    df = df.sort_values(["SID", "ISO_TIME"]).reset_index(drop=True)
    return df


def train(df: pd.DataFrame, seed: int = RNG_SEED) -> tuple[XGBClassifier, dict]:
    X = df[FEATURES].to_numpy(dtype=float)
    y = df[TARGET].to_numpy(dtype=int)
    assert len(np.unique(y)) == 2, "Need both classes; adjust synthesis RI rate"
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=0.22, random_state=seed, stratify=y
    )
    neg, pos = int((y_tr == 0).sum()), int((y_tr == 1).sum())
    clf = XGBClassifier(
        n_estimators=320,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        min_child_weight=2,
        gamma=0.1,
        reg_alpha=0.1,
        reg_lambda=1.0,
        scale_pos_weight=neg / max(pos, 1),
        eval_metric="logloss",
        tree_method="hist",
        random_state=seed,
        n_jobs=-1,
    )
    clf.fit(X_tr, y_tr)
    proba = clf.predict_proba(X_te)[:, 1]
    pred = (proba >= 0.5).astype(int)
    metrics = {
        "accuracy": float(accuracy_score(y_te, pred)),
        "precision": float(precision_score(y_te, pred, zero_division=0)),
        "recall": float(recall_score(y_te, pred, zero_division=0)),
        "f1": float(f1_score(y_te, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_te, proba)),
        "confusion_matrix": confusion_matrix(y_te, pred).tolist(),
        "n_train": int(len(y_tr)),
        "n_test": int(len(y_te)),
        "n_storms": int(df["SID"].nunique()),
        "n_points": int(len(df)),
        "ri_rate": float(y.mean()),
        "ri_train_pos": int(pos),
        "features": FEATURES,
        "target": TARGET,
        "ri_definition": "future_max_wind_24h - WIND_KT >= 30kt",
        "model": "XGBClassifier",
    }
    return clf, metrics


def main() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    print("Synthesizing 60 NIO-like tracks...")
    df = synthesize_storms(60, RNG_SEED)
    print(f"points={len(df)} storms={df['SID'].nunique()} ri_rate={df['ri_label'].mean():.3f}")
    clf, metrics = train(df)
    print("metrics:", json.dumps(metrics, indent=2))
    df.to_parquet(MODELS_DIR / "clean_storms.parquet", index=False)
    with open(MODELS_DIR / "ri_model.pkl", "wb") as f:
        pickle.dump(clf, f)
    with open(MODELS_DIR / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"Artifacts written to {MODELS_DIR.resolve()}")


if __name__ == "__main__":
    main()
