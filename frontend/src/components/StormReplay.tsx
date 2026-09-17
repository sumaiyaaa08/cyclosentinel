import { useEffect, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
} from "react-leaflet";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";
import { useApp } from "../store/AppContext";
import { LoadingSkeleton } from "./LoadingSkeleton";

function windColor(w: number): string {
  if (w >= 100) return "#f43f5e";
  if (w >= 64) return "#fb923c";
  if (w >= 34) return "#14b8a6";
  return "#38bdf8";
}

export function StormReplay() {
  const { state, dispatch } = useApp();
  const { storms, selectedSid, track, stepIdx } = state;
  const [showCone, setShowCone] = useState(true);
  const [showIntensity, setShowIntensity] = useState(true);
  const [cone, setCone] = useState<[number, number][]>([]);
  const loading = state.loading["storms"] || state.loading["track"];
  const error = state.error["storms"] ?? state.error["track"] ?? state.error["geojson"];

  // load catalog once
  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      dispatch({ type: "SET_LOADING", key: "storms", value: true });
      dispatch({ type: "SET_ERROR", key: "storms", value: null });
      try {
        const data = await api.storms(ctl.signal);
        dispatch({ type: "SET_STORMS", storms: data });
      } catch (e) {
        if (!ctl.signal.aborted)
          dispatch({ type: "SET_ERROR", key: "storms", value: (e as Error).message });
      } finally {
        if (!ctl.signal.aborted)
          dispatch({ type: "SET_LOADING", key: "storms", value: false });
      }
    })();
    return () => ctl.abort();
  }, [dispatch]);

  // load track + geojson cone on sid change (no hardcoded geometry)
  useEffect(() => {
    if (!selectedSid) return;
    const ctl = new AbortController();
    (async () => {
      dispatch({ type: "SET_LOADING", key: "track", value: true });
      dispatch({ type: "SET_ERROR", key: "track", value: null });
      dispatch({ type: "SET_ERROR", key: "geojson", value: null });
      try {
        const [body, fc] = await Promise.all([
          api.storm(selectedSid, ctl.signal),
          api.geojson(selectedSid, ctl.signal),
        ]);
        dispatch({ type: "SET_TRACK", track: body.track });
        const poly = fc.features.find((f) => f.geometry.type === "Polygon");
        if (poly && poly.geometry.type === "Polygon") {
          const ring = poly.geometry.coordinates[0].map(
            ([lon, lat]) => [lat, lon] as [number, number]
          );
          setCone(ring);
        } else {
          setCone([]);
        }
      } catch (e) {
        if (!ctl.signal.aborted) {
          const msg = (e as Error).message;
          dispatch({ type: "SET_ERROR", key: "track", value: msg });
          dispatch({ type: "SET_ERROR", key: "geojson", value: msg });
        }
      } finally {
        if (!ctl.signal.aborted)
          dispatch({ type: "SET_LOADING", key: "track", value: false });
      }
    })();
    return () => ctl.abort();
  }, [selectedSid, dispatch]);

  const cur = track[stepIdx];
  const line: [number, number][] = track.map((p) => [p.LAT, p.LON]);
  const center: [number, number] = cur ? [cur.LAT, cur.LON] : [15, 80];

  if (loading && track.length === 0) return <LoadingSkeleton label="storm replay" />;
  if (error)
    return (
      <div className="rounded-xl border border-[#f43f5e] p-4 text-sm">
        <p className="text-[#f43f5e]">Failed to load: {error}</p>
      </div>
    );

  const probPct = cur ? Math.round(cur.model_ri_prob * 100) : 0;
  const gaugeColor = cur && cur.model_ri_prob >= 0.5 ? "#f43f5e" : "#14b8a6";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs uppercase tracking-wider opacity-70">Storm</label>
        <select
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm"
          value={selectedSid ?? ""}
          onChange={(e) => dispatch({ type: "SELECT_SID", sid: e.target.value })}
        >
          {storms.map((s) => (
            <option key={s.sid} value={s.sid}>
              {s.sid} · {s.max_wind_kt.toFixed(0)}kt · {s.n_points}pts
            </option>
          ))}
        </select>
        <label className="ml-2 flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={showCone}
            onChange={(e) => setShowCone(e.target.checked)}
          />
          Cone
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={showIntensity}
            onChange={(e) => setShowIntensity(e.target.checked)}
          />
          Intensity colors
        </label>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-7">
          <MapContainer center={center} zoom={5} style={{ height: 380, width: "100%" }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {line.length > 1 && <Polyline positions={line} color="#14b8a6" />}
            {showCone && cone.length >= 4 && (
              <Polygon
                positions={cone}
                pathOptions={{ color: "#f43f5e", fillOpacity: 0.15 }}
              />
            )}
            {track.map((p, i) => (
              <CircleMarker
                key={i}
                center={[p.LAT, p.LON]}
                radius={i === stepIdx ? 8 : 4}
                color={showIntensity ? windColor(p.WIND_KT) : "#14b8a6"}
                fillOpacity={0.85}
              />
            ))}
          </MapContainer>
          <input
            type="range"
            min={0}
            max={Math.max(0, track.length - 1)}
            value={stepIdx}
            onChange={(e) =>
              dispatch({ type: "SET_STEP", idx: Number(e.target.value) })
            }
            className="mt-3 w-full"
            aria-label="replay step"
          />
          <p className="text-xs opacity-70">
            Step {stepIdx + 1}/{track.length} · {cur?.ISO_TIME} · {cur?.LAT.toFixed(2)}N{" "}
            {cur?.LON.toFixed(2)}E
          </p>
        </div>

        <div className="col-span-5 space-y-3">
          <div className="rounded-xl bg-slate-800 p-4">
            <p className="text-xs uppercase opacity-70">RI probability (model)</p>
            <p className="text-3xl font-bold" style={{ color: gaugeColor }}>
              {probPct}%
            </p>
            <div className="mt-2 h-3 overflow-hidden rounded bg-slate-700">
              <div
                className="h-full"
                style={{ width: `${probPct}%`, background: gaugeColor }}
              />
            </div>
            <p className="mt-2 text-xs">
              GT RI: {cur?.ri_label} · Wind {cur?.WIND_KT}kt · Pres {cur?.PRES_HPA}hPa
            </p>
          </div>
          <div className="h-56 rounded-xl bg-slate-800 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={track}>
                <CartesianGrid stroke="#334155" />
                <XAxis dataKey="ISO_TIME" tick={false} />
                <YAxis yAxisId="w" orientation="left" stroke="#14b8a6" />
                <YAxis yAxisId="p" orientation="right" domain={[0, 1]} stroke="#f43f5e" />
                <Tooltip />
                <Legend />
                <Line yAxisId="w" type="monotone" dataKey="WIND_KT" stroke="#14b8a6" dot={false} />
                <Line yAxisId="p" type="monotone" dataKey="model_ri_prob" stroke="#f43f5e" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
