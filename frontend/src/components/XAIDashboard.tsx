import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type ExplainOutput, type PredictInput } from "../lib/api";
import { useApp } from "../store/AppContext";
import { LoadingSkeleton } from "./LoadingSkeleton";

function pointToInput(track: { LAT: number; LON: number; WIND_KT: number; PRES_HPA: number; trans_speed_kmh: number; bearing_deg: number; wind_trend_12h: number; pres_trend_12h: number; day_of_year: number }): PredictInput {
  return {
    lat: track.LAT,
    lon: track.LON,
    wind_kt: track.WIND_KT,
    pres_hpa: track.PRES_HPA,
    trans_speed_kmh: track.trans_speed_kmh,
    bearing_deg: track.bearing_deg,
    wind_trend_12h: track.wind_trend_12h,
    pres_trend_12h: track.pres_trend_12h,
    day_of_year: track.day_of_year,
  };
}

export function XAIDashboard() {
  const { state } = useApp();
  const [out, setOut] = useState<ExplainOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cur = state.track[state.stepIdx];

  async function explain() {
    if (!cur) {
      setError("Select a storm replay point first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.explain(pointToInput(cur));
      setOut(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const bars = out
    ? Object.entries(out.shap_values)
        .map(([feature, value]) => ({ feature, value }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    : [];

  return (
    <div className="rounded-xl bg-slate-800 p-4">
      <h2 className="font-semibold text-[#14b8a6]">XAI Dashboard (SHAP)</h2>
      <p className="mt-1 text-xs opacity-70">
        TreeExplainer attributions for the current replay point. Nothing hardcoded —
        all values from <code>/api/predict/explain</code>.
      </p>
      <button
        onClick={explain}
        disabled={loading || !cur}
        className="mt-3 rounded-lg bg-[#14b8a6] px-4 py-2 text-sm font-bold text-[#0f172a] disabled:opacity-50"
      >
        {loading ? "Explaining…" : "Explain current point"}
      </button>
      {loading && (
        <div className="mt-3">
          <LoadingSkeleton label="shap explanation" />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-[#f43f5e]">{error}</p>}
      {out && (
        <div className="mt-3 text-sm">
          <p>
            RI prob <strong>{(out.ri_probability * 100).toFixed(1)}%</strong> · base{" "}
            {out.base_value.toFixed(3)} · top <strong>{out.top_feature}</strong>
          </p>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} layout="vertical">
                <CartesianGrid stroke="#334155" />
                <XAxis type="number" stroke="#94a3b8" />
                <YAxis type="category" dataKey="feature" width={120} stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value">
                  {bars.map((b) => (
                    <Cell key={b.feature} fill={b.value >= 0 ? "#f43f5e" : "#14b8a6"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
