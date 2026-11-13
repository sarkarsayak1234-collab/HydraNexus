import { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Global error boundary — a crashing component must NEVER blank the whole
 * dashboard silently. Renders the real error message on screen so problems
 * are visible (and reportable) instead of an empty dark page.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[HydraNexus] render error:', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      const message = this.state.error?.message || String(this.state.error)
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0a1220] p-6">
          <div className="w-full max-w-xl rounded-2xl border border-rose-800/60 bg-[#0c1626] p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-rose-400" />
              <h1 className="text-base font-bold text-white">Something in the dashboard crashed</h1>
            </div>
            <p className="mt-3 text-xs font-mono leading-relaxed text-rose-300 bg-rose-950/30 border border-rose-900/50 rounded-lg p-3 break-words">
              {message}
            </p>
            <p className="mt-3 text-[11px] text-slate-500">
              The rest of the app is fine — this is shown instead of a blank page so the issue can be reported
              and fixed precisely.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-mono font-medium text-white hover:bg-sky-500"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reload app
              </button>
              <button
                onClick={() => this.setState({ error: null })}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-mono text-slate-300 hover:border-slate-500"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
