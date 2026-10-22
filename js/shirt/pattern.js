// Moldería (implementación provisoria).
export function createPattern(opts) {
  return { key: `${opts.size}-${opts.fit}-${opts.sleeve}-${opts.neck}`, opts, pieces: [], silhouette: null, measurements: {} };
}
