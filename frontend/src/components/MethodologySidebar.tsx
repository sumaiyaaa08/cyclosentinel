import { useEffect } from "react";
import { api } from "../lib/api";
import { useApp } from "../store/AppContext";
import { LoadingSkeleton } from "./LoadingSkeleton";

export function MethodologySidebar() {
  const { state, dispatch } = useApp();
  const { metrics } = state;
  const loading = state.loading["metrics"];
  const error = state.error["metrics"];

  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      dispatch({ type: "SET_LOADING", key: "metrics", value: true });
      try {
        const m = await api.metrics(ctl.signal);
        dispatch({ type: "SET_METRICS", metrics: m });
      } catch (e) {
        if (!ctl.signal.aborted)
          dispatch({ type: "SET_ERROR", key: "metrics", value: (e as Error).message });
      } finally {
        if (!ctl.signal.aborted)
          dispatch({ type: "SET_LOADING", key: "metrics", value: false });
      }
    })();
    return () => ctl.abort();
  }, [dispatch]);

  if (loading && !metrics) return <LoadingSkeleton label="methodology" />;
  if (error) return <p className="text-sm text-[#f43f5e]">Metrics failed: {error}</p>;
  if (!metrics) return null;

  const rows: [string, string][] = [
    ["Accuracy", metrics.accuracy.toFixed(3)],
    ["Precision", metrics.precision.toFixed(3)],
    ["Recall", metrics.recall.toFixed(3)],
    ["F1", metrics.f1.toFixed(3)],
    ["ROC-AUC", metrics.roc_auc.toFixed(3)],
    ["Storms", String(metrics.n_storms)],
    ["Points", String(metrics.n_points)],
    ["RI rate", `${(metrics.ri_rate * 100).toFixed(1)}%`],
  ];

  return (
    <aside className="rounded-xl bg-slate-800 p-4 text-sm">
      <h2 className="font-semibold text-[#14b8a6]">Methodology</h2>
      <p className="mt-1 text-xs opacity-70">
        XGBoost on 6-hourly NIO best-track features. RI = +30kt / 24h.
      </p>
      <dl className="mt-3 space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-slate-700 pb-1">
            <dt className="opacity-70">{k}</dt>
            <dd className="font-mono font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs opacity-60">
        Confusion: [{metrics.confusion_matrix[0]?.join(", ")}] / [
        {metrics.confusion_matrix[1]?.join(", ")}]
      </p>
    </aside>
  );
}
