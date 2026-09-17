import { useState } from "react";
import { api, type PredictInput, type PredictOutput } from "../lib/api";

const defaults: PredictInput = {
  lat: 14.5,
  lon: 87.0,
  wind_kt: 65,
  pres_hpa: 970,
  trans_speed_kmh: 15,
  bearing_deg: 320,
  wind_trend_12h: 10,
  pres_trend_12h: -6,
  day_of_year: 300,
};

const fields: { key: keyof PredictInput; min: number; max: number; step: number }[] = [
  { key: "lat", min: -10, max: 40, step: 0.1 },
  { key: "lon", min: 40, max: 105, step: 0.1 },
  { key: "wind_kt", min: 10, max: 200, step: 1 },
  { key: "pres_hpa", min: 850, max: 1020, step: 1 },
  { key: "trans_speed_kmh", min: 0, max: 80, step: 0.5 },
  { key: "bearing_deg", min: 0, max: 360, step: 1 },
  { key: "wind_trend_12h", min: -60, max: 60, step: 0.5 },
  { key: "pres_trend_12h", min: -30, max: 30, step: 0.5 },
  { key: "day_of_year", min: 1, max: 366, step: 1 },
];

export function ManualInput() {
  const [form, setForm] = useState<PredictInput>(defaults);
  const [result, setResult] = useState<PredictOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const out = await api.predict(form);
      setResult(out);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl bg-slate-800 p-4">
      <h2 className="font-semibold">Manual Forecaster Input</h2>
      {error && <p className="mt-2 text-sm text-[#f43f5e]">{error}</p>}
      <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <label key={f.key} className="text-xs">
            <span className="uppercase opacity-70">{f.key}</span>
            <input
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              value={form[f.key]}
              onChange={(e) =>
                setForm({ ...form, [f.key]: Number(e.target.value) })
              }
              className="mt-1 w-full rounded bg-slate-900 px-2 py-1.5 text-sm"
            />
          </label>
        ))}
        <button
          type="submit"
          disabled={loading}
          className="col-span-2 rounded-lg bg-[#14b8a6] px-4 py-2 font-bold text-[#0f172a] disabled:opacity-50"
        >
          {loading ? "Predicting…" : "Predict RI"}
        </button>
      </form>
      {loading && <p className="mt-2 text-xs opacity-70">Loading…</p>}
      {result && (
        <div className="mt-3 rounded-lg bg-slate-900 p-3 text-sm">
          <p>
            RI probability:{" "}
            <strong
              style={{ color: result.ri_probability >= 0.5 ? "#f43f5e" : "#14b8a6" }}
            >
              {(result.ri_probability * 100).toFixed(1)}%
            </strong>
          </p>
          <p>Prediction: {result.ri_prediction === 1 ? "RI LIKELY" : "No RI"}</p>
        </div>
      )}
    </div>
  );
}
