// Persisted asset URLs stay stable across local / and hosted /canvas/ deployments.
export const canvasBase = import.meta.env.BASE_URL;
export function canvasUrl(path = '/') {
  return `${canvasBase}${path.replace(/^\/+/, '')}`;
}
export function canvasAssetUrl(path) {
  return path.startsWith('/') && !path.startsWith('//') ? canvasUrl(path) : path;
}
export function canvasPathname() {
  const path = window.location.pathname;
  return path.startsWith(canvasBase) ? `/${path.slice(canvasBase.length)}` : path;
}
