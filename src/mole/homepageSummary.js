const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_NEGATIVE_TTL_MS = 15_000;

function iso(ms) {
  return new Date(ms).toISOString();
}

function safeSourceAt(value) {
  return Number.isFinite(Date.parse(value || "")) ? value : null;
}

function publicError(error) {
  if (error?.name === "AbortError") return "source_timeout";
  return "source_unavailable";
}

/**
 * Compose independently cached, public homepage facts. Each source has one
 * in-flight refresh promise, so a cold-cache burst cannot multiply expensive
 * RPC or health work. A failed refresh may serve the last known value, but it
 * is always marked stale and retains the original source timestamp.
 */
export function createSingleFlightReader(read) {
  let inFlight = null;
  return async (...args) => {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(() => read(...args)).finally(() => { inFlight = null; });
    return inFlight;
  };
}

export function readFreshCachedSnapshot(entry, { now = () => Date.now(), ttlMs } = {}) {
  if (!entry || !Number.isFinite(entry.at) || now() - entry.at >= ttlMs) {
    throw new Error("cached_snapshot_unavailable");
  }
  return entry.data;
}

export function createHomepageSummary({
  sources,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  negativeTtlMs = DEFAULT_NEGATIVE_TTL_MS,
}) {
  const cache = new Map();
  const failures = new Map();
  const inFlight = new Map();

  async function refresh(name, source) {
    if (inFlight.has(name)) return inFlight.get(name);
    const promise = (async () => {
      const controller = new AbortController();
      let rejectTimeout;
      const deadline = new Promise((_, reject) => { rejectTimeout = reject; });
      const timer = setTimeout(() => {
        controller.abort();
        const error = new Error("source_timeout");
        error.name = "AbortError";
        rejectTimeout(error);
      }, source.timeoutMs || timeoutMs);
      try {
        const raw = await Promise.race([source.read({ signal: controller.signal }), deadline]);
        const value = source.normalize(raw);
        const cachedAtMs = now();
        const ttlMs = Math.max(1_000, Number(source.ttlMs) || 60_000);
        const entry = {
          value,
          sourceAt: safeSourceAt(source.sourceAt?.(raw, value)),
          cachedAtMs,
          expiresAtMs: cachedAtMs + ttlMs,
        };
        cache.set(name, entry);
        failures.delete(name);
        return { ...entry, state: "live" };
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => inFlight.delete(name));
    inFlight.set(name, promise);
    return promise;
  }

  async function item(name, source) {
    const existing = cache.get(name);
    const at = now();
    if (existing && at < existing.expiresAtMs) return { ...existing, state: "live" };
    const failure = failures.get(name);
    if (failure && at < failure.expiresAtMs) {
      if (existing) return { ...existing, state: "stale", error: failure.error, retryAtMs: failure.expiresAtMs };
      return { state: "unavailable", ...failure, retryAtMs: failure.expiresAtMs };
    }
    try {
      return await refresh(name, source);
    } catch (error) {
      const cachedAtMs = now();
      const boundedNegativeTtlMs = Math.min(60_000, Math.max(1_000, Number(source.negativeTtlMs) || Number(negativeTtlMs) || DEFAULT_NEGATIVE_TTL_MS));
      const failed = { error: publicError(error), cachedAtMs, expiresAtMs: cachedAtMs + boundedNegativeTtlMs };
      failures.set(name, failed);
      if (existing) return { ...existing, state: "stale", error: failed.error, retryAtMs: failed.expiresAtMs };
      return { state: "unavailable", ...failed, retryAtMs: failed.expiresAtMs };
    }
  }

  return async function buildHomepageSummary() {
    const entries = await Promise.all(Object.entries(sources).map(async ([name, source]) => [name, await item(name, source)]));
    const servedAtMs = now();
    const items = Object.fromEntries(entries.map(([name, entry]) => {
      if (entry.state === "unavailable") {
        return [name, {
          state: entry.state,
          error: entry.error,
          cachedAt: iso(entry.cachedAtMs),
          retryAt: iso(entry.retryAtMs),
          expiresAt: iso(entry.expiresAtMs),
          servedAt: iso(servedAtMs),
          evidence: sources[name].evidence,
        }];
      }
      return [name, {
        state: entry.state,
        ...entry.value,
        sourceAt: entry.sourceAt,
        cachedAt: iso(entry.cachedAtMs),
        expiresAt: iso(entry.expiresAtMs),
        servedAt: iso(servedAtMs),
        evidence: sources[name].evidence,
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.retryAtMs ? { retryAt: iso(entry.retryAtMs) } : {}),
      }];
    }));
    return { ok: true, schemaVersion: 1, generatedAt: iso(servedAtMs), items };
  };
}
