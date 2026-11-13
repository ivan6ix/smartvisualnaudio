import { Component } from "react";
import { isChunkLoadError, reloadForNewVersion } from "../lib/chunkReload";

// Catches anything that breaks while a page draws, so the app never turns into a blank screen.
// Old page files after a new release reload the page once; anything else shows a message with a Reload button.
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reloading: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (isChunkLoadError(error) && reloadForNewVersion()) {
      this.setState({ reloading: true });
      return;
    }
    window.console.error("[app] A page failed to draw.", error, info?.componentStack);
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    const updated = isChunkLoadError(error);
    return (
      <main className="app-crash" role="alert">
        <div className="app-crash-card">
          <h1>{reloading || updated ? "Loading the latest version…" : "Something went wrong"}</h1>
          <p>
            {updated
              ? "A new version of Smart Proctoring was released while this tab was open. Reload to continue."
              : "This page could not be shown. Reload to try again. If it keeps happening, tell your administrator."}
          </p>
          {!updated && error?.message ? <code>{String(error.message).slice(0, 200)}</code> : null}
          <button type="button" className="btn" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </main>
    );
  }
}
