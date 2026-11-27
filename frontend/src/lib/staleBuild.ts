// After a new deploy, an already-open tab may request page chunks that no longer exist.
// Detect that and reload once to pick up the current build (guarded against reload loops).
const KEY = "bs.staleReloadAt";

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? "");
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk \S+ failed/i.test(msg);
}

/** Reloads the page unless we already did so in the last 30 seconds. Returns true if a reload was started. */
export function reloadForNewBuild(): boolean {
  const last = Number(sessionStorage.getItem(KEY) ?? 0);
  if (Date.now() - last < 30_000) return false;
  sessionStorage.setItem(KEY, String(Date.now()));
  window.location.reload();
  return true;
}
