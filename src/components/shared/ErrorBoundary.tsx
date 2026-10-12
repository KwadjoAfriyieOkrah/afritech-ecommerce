'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  fallback?: (reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    const { children, title = 'Something went wrong', fallback } = this.props;

    if (!error) return children;

    if (fallback) return fallback(this.reset);

    return (
      <div role="alert" className="alert-error flex flex-col items-start gap-3">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-red-700">{error.message}</p>
        </div>
        <button type="button" onClick={this.reset} className="btn btn-outline">
          Try again
        </button>
      </div>
    );
  }
}