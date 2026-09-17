import React, { createContext, useContext, useMemo, useReducer } from "react";
import type { ModelMetrics, StormSummary, TrackPoint } from "../lib/api";

interface State {
  storms: StormSummary[];
  selectedSid: string | null;
  track: TrackPoint[];
  stepIdx: number;
  metrics: ModelMetrics | null;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
}

type Action =
  | { type: "SET_STORMS"; storms: StormSummary[] }
  | { type: "SELECT_SID"; sid: string }
  | { type: "SET_TRACK"; track: TrackPoint[] }
  | { type: "SET_STEP"; idx: number }
  | { type: "SET_METRICS"; metrics: ModelMetrics }
  | { type: "SET_LOADING"; key: string; value: boolean }
  | { type: "SET_ERROR"; key: string; value: string | null };

const initial: State = {
  storms: [],
  selectedSid: null,
  track: [],
  stepIdx: 0,
  metrics: null,
  loading: {},
  error: {},
};

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "SET_STORMS":
      return {
        ...s,
        storms: a.storms,
        selectedSid: s.selectedSid ?? (a.storms[0]?.sid ?? null),
      };
    case "SELECT_SID":
      return { ...s, selectedSid: a.sid, stepIdx: 0, track: [] };
    case "SET_TRACK":
      return { ...s, track: a.track, stepIdx: 0 };
    case "SET_STEP":
      return { ...s, stepIdx: a.idx };
    case "SET_METRICS":
      return { ...s, metrics: a.metrics };
    case "SET_LOADING":
      return { ...s, loading: { ...s.loading, [a.key]: a.value } };
    case "SET_ERROR":
      return { ...s, error: { ...s.error, [a.key]: a.value } };
    default:
      return s;
  }
}

const Ctx = createContext<{ state: State; dispatch: React.Dispatch<Action> } | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}
