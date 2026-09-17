import { ErrorBoundary } from "./components/ErrorBoundary";
import { LiveOpsHub } from "./components/LiveOpsHub";
import { ManualInput } from "./components/ManualInput";
import { MethodologySidebar } from "./components/MethodologySidebar";
import { StormReplay } from "./components/StormReplay";
import { XAIDashboard } from "./components/XAIDashboard";

export default function App() {
  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100">
      <header className="border-b border-slate-700 px-6 py-4">
        <h1 className="text-2xl font-bold">
          CycloSentinel <span className="text-[#14b8a6]">SIH26070</span>
        </h1>
        <p className="text-sm opacity-70">
          Tropical cyclone Rapid Intensification decision support · North Indian Ocean
        </p>
      </header>
      <main className="grid grid-cols-12 gap-4 p-4">
        <div className="col-span-3 space-y-4">
          <ErrorBoundary>
            <MethodologySidebar />
          </ErrorBoundary>
          <ErrorBoundary>
            <LiveOpsHub />
          </ErrorBoundary>
        </div>
        <div className="col-span-6 space-y-4">
          <div className="rounded-xl bg-[#1e293b] p-4">
            <ErrorBoundary>
              <StormReplay />
            </ErrorBoundary>
          </div>
          <ErrorBoundary>
            <XAIDashboard />
          </ErrorBoundary>
        </div>
        <div className="col-span-3">
          <ErrorBoundary>
            <ManualInput />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
