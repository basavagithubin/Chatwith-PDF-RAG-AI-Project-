import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { message: string | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    return { message };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('PDFChat render error', error, info.componentStack);
  }

  render() {
    if (!this.state.message) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted px-6">
        <div className="max-w-md rounded-2xl bg-surface p-8 text-center shadow-card">
          <h1 className="font-display text-xl font-semibold text-ink-950">This page could not load</h1>
          <p className="mt-3 text-sm text-ink-600">{this.state.message}</p>
          <button type="button" className="btn-primary mt-6 w-full" onClick={() => window.location.assign('/')}>
            Back to library
          </button>
        </div>
      </div>
    );
  }
}
