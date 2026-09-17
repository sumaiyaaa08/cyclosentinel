import { useCallback, useEffect, useRef, useState } from "react";
import { api, type LiveObs } from "../lib/api";
import { LoadingSkeleton } from "./LoadingSkeleton";

export function LiveOpsHub() {
  const [obs, setObs] = useState<LiveObs | null>(null);
  const [history, setHistory] = useState<LiveObs[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const timer = useRef<number | null>(null);

  const poll = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.liveFeed(signal);
      setObs(data);
      setHistory((h) => [data, ...h].slice(0, 5));
      setError(null);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    poll(ctl.signal);
    timer.current = window.setInterval(() => {
      setTick((t) => t + 1);
    }, 15000);
    return () => {
      ctl.abort();
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [poll]);

  useEffect(() => {
    if (tick === 0) return;
    const ctl = new AbortController();
    poll(ctl.signal);
    return () => ctl.abort();
  }, [tick, poll]);

  if (loading && !obs) return <LoadingSkeleton label="live operations" />;

  const alertColor =
    obs?.alert_level === "HIGH"
      ? "#f43f5e"
      : obs?.alert_level === "WATCH"
        ? "#fb923c"
        : "#14b8a6";

  return (
    <div className="rounded-xl bg-slate-800 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Live Operations Hub</h2>
        <button
          onClick={() => poll()}
          className="rounded bg-slate-700 px-2 py-1 text-xs"
        >
          Refresh now
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-[#f43f5e]">Feed error: {error}</p>}
      {obs && (
        <div
          className="mt-3 rounded-lg border p-3 text-sm"
          style={{ borderColor: alertColor }}
        >
          <p className="font-bold" style={{ color: alertColor }}>
            {obs.alert_level === "HIGH"
              ? "⚠ HIGH RI RISK"
              : obs.alert_level === "WATCH"
                ? "● RI WATCH"
                : "○ LOW RISK"}{" "}
            · {(obs.model_ri_prob * 100).toFixed(1)}%
          </p>
          <p className="mt-1 text-xs opacity-80">
            {obs.sid} · {obs.LAT.toFixed(2)}N {obs.LON.toFixed(2)}E · {obs.WIND_KT.toFixed(0)}kt ·{" "}
            {obs.PRES_HPA.toFixed(0)}hPa
          </p>
          <p className="text-xs opacity-60">Observed {obs.ISO_TIME}</p>
        </div>
      )}
      {history.length > 1 && (
        <ul className="mt-2 space-y-1 text-xs opacity-80">
          {history.slice(1).map((h, i) => (
            <li key={i}>
              {h.sid} · {(h.model_ri_prob * 100).toFixed(0)}% · {h.alert_level}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs opacity-50">Polling /api/live_feed every 15s</p>
    </div>
  );
}
