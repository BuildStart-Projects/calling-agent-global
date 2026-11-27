import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isChunkLoadError, reloadForNewBuild } from "@/lib/staleBuild";

type Props = { children: ReactNode };
type State = { error: Error | null; updating: boolean };

/** Catches render errors so the app never goes blank. Stale-build chunk errors trigger one automatic reload. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, updating: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, updating: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App error:", error, info.componentStack);
    if (isChunkLoadError(error) && !reloadForNewBuild()) this.setState({ updating: false });
  }

  render() {
    const { error, updating } = this.state;
    if (!error) return this.props.children;
    if (updating) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-center" role="status">
          <div><RefreshCw className="mx-auto h-8 w-8 animate-spin text-brand-500" /><p className="mt-3 text-sm text-muted-foreground">Updating to the latest version…</p></div>
        </div>
      );
    }
    const stale = isChunkLoadError(error);
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle className="h-6 w-6" /></div>
          <h1 className="mt-4 text-xl font-semibold">{stale ? "A new version is available" : "Something went wrong"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{stale ? "Reload the page to continue with the latest version of BuildStart." : "This page hit an unexpected error. Reloading usually fixes it. Your data is safe."}</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => window.location.reload()}><RefreshCw className="mr-2 h-4 w-4" />Reload page</Button>
            <Button variant="outline" onClick={() => { window.location.href = "/app"; }}>Go to dashboard</Button>
          </div>
        </div>
      </div>
    );
  }
}
