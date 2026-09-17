"""Pytest coverage for CycloSentinel Phase 1+2 API."""
from fastapi.testclient import TestClient

from backend.main import FEATURES, app

client = TestClient(app)

_PRED = {
    "lat": 14.5,
    "lon": 87.0,
    "wind_kt": 65.0,
    "pres_hpa": 970.0,
    "trans_speed_kmh": 15.0,
    "bearing_deg": 320.0,
    "wind_trend_12h": 10.0,
    "pres_trend_12h": -6.0,
    "day_of_year": 300,
}


def test_list_storms():
    r = client.get("/api/storms")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) >= 50
    assert "sid" in data[0] and "max_wind_kt" in data[0]


def test_get_storm_track_has_model_prob():
    storms = client.get("/api/storms").json()
    sid = storms[0]["sid"]
    r = client.get(f"/api/storms/{sid}")
    assert r.status_code == 200
    body = r.json()
    assert body["sid"] == sid
    assert len(body["track"]) > 10
    pt = body["track"][0]
    for k in ("LAT", "LON", "WIND_KT", "ri_label", "model_ri_prob"):
        assert k in pt
    assert 0.0 <= pt["model_ri_prob"] <= 1.0


def test_get_storm_404():
    r = client.get("/api/storms/NOPE000NIO")
    assert r.status_code == 404


def test_predict_valid():
    payload = {
        "lat": 14.5,
        "lon": 87.0,
        "wind_kt": 65.0,
        "pres_hpa": 970.0,
        "trans_speed_kmh": 15.0,
        "bearing_deg": 320.0,
        "wind_trend_12h": 10.0,
        "pres_trend_12h": -6.0,
        "day_of_year": 300,
    }
    r = client.post("/api/predict", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert 0.0 <= body["ri_probability"] <= 1.0
    assert body["ri_prediction"] in (0, 1)


def test_predict_validation_rejects():
    bad = {
        "lat": 14.5,
        "lon": 87.0,
        "wind_kt": 500.0,  # out of 10-200 range
        "pres_hpa": 970.0,
        "trans_speed_kmh": 15.0,
        "bearing_deg": 320.0,
        "wind_trend_12h": 10.0,
        "pres_trend_12h": -6.0,
        "day_of_year": 300,
    }
    r = client.post("/api/predict", json=bad)
    assert r.status_code == 422


def test_metrics_endpoint():
    r = client.get("/api/model/metrics")
    assert r.status_code == 200
    m = r.json()
    for k in ("accuracy", "precision", "recall", "f1", "roc_auc"):
        assert k in m


def test_explain_returns_shap():
    r = client.post("/api/predict/explain", json=_PRED)
    assert r.status_code == 200
    body = r.json()
    assert 0.0 <= body["ri_probability"] <= 1.0
    assert set(body["shap_values"].keys()) == set(FEATURES)
    assert body["top_feature"] in FEATURES
    assert isinstance(body["base_value"], float)


def test_explain_validation_rejects():
    bad = dict(_PRED, wind_kt=500.0)
    r = client.post("/api/predict/explain", json=bad)
    assert r.status_code == 422


def test_live_feed_shape():
    r = client.get("/api/live_feed")
    assert r.status_code == 200
    body = r.json()
    for k in ("sid", "LAT", "LON", "WIND_KT", "model_ri_prob", "alert", "alert_level"):
        assert k in body
    assert 0.0 <= body["model_ri_prob"] <= 1.0
    assert body["alert_level"] in ("HIGH", "WATCH", "LOW")


def test_geojson_cone():
    sid = client.get("/api/storms").json()[0]["sid"]
    r = client.get(f"/api/storms/{sid}/geojson")
    assert r.status_code == 200
    fc = r.json()
    assert fc["type"] == "FeatureCollection"
    kinds = [f["geometry"]["type"] for f in fc["features"]]
    assert "LineString" in kinds and "Polygon" in kinds and "Point" in kinds
    poly = next(f for f in fc["features"] if f["geometry"]["type"] == "Polygon")
    assert poly["properties"]["kind"] == "cone_of_uncertainty_mock"
    assert len(poly["geometry"]["coordinates"][0]) >= 5


def test_geojson_404():
    assert client.get("/api/storms/NOPE000NIO/geojson").status_code == 404
