import React from "react";

interface Props {
  children: React.ReactNode;
}

interface S {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<Props, S> {
  state: S = { hasError: false, message: "" };

  static getDerivedStateFromError(e: Error): S {
    return { hasError: true, message: e.message };
  }

  componentDidCatch(e: Error) {
    console.error("UI error:", e);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-[#f43f5e] bg-[#0f172a] p-4 text-sm text-slate-200">
          <p className="font-semibold text-[#f43f5e]">View failed to render</p>
          <p className="mt-1 opacity-80">{this.state.message}</p>
          <button
            className="mt-3 rounded bg-[#14b8a6] px-3 py-1 font-semibold text-[#0f172a]"
            onClick={() => this.setState({ hasError: false, message: "" })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
