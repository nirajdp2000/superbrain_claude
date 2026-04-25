/**
 * Provenance wrapper — every numeric field in a snapshot carries
 * {value, source, fetchedAt, confidence} so the UI can render
 * "1m ago · via Upstox · HIGH confidence" tooltips.
 *
 * Guiding principle #3 (TRANSFORMATION_ROADMAP §1): No naked numbers in the UI.
 */

/**
 * @typedef {"live" | "delayed" | "cached" | "fallback" | "unavailable"} Confidence
 */

/**
 * @typedef {Object} Provenance
 * @property {*} value          — the actual data (number, object, array)
 * @property {string} source    — e.g. "upstox", "nse-official", "yahoo", "screener", "synthetic"
 * @property {number} fetchedAt — epoch ms when the data was captured
 * @property {Confidence} confidence
 * @property {number} [latencyMs] — optional, how long the fetch took
 */

/**
 * Wrap a raw value with provenance metadata.
 *
 * @param {*} value
 * @param {string} source
 * @param {Confidence} [confidence="live"]
 * @param {Object} [extra] — optional {latencyMs, fetchedAt}
 * @returns {Provenance}
 */
export function wrap(value, source, confidence = "live", extra = {}) {
  return {
    value,
    source,
    fetchedAt: extra.fetchedAt ?? Date.now(),
    confidence,
    ...(extra.latencyMs !== undefined ? { latencyMs: extra.latencyMs } : {}),
  };
}

/**
 * Unwrap a provenance field back to its raw value. Tolerant of non-wrapped
 * values (returns them as-is) so existing callers pass through unchanged.
 *
 * @param {*} field
 * @returns {*}
 */
export function unwrap(field) {
  if (field && typeof field === "object" && "value" in field && "source" in field) {
    return field.value;
  }
  return field;
}

/**
 * Shortcut for "data unavailable" provenance — keeps the shape consistent so
 * the UI doesn't have to branch on null vs wrapped-null.
 *
 * @param {string} [reason]
 * @returns {Provenance}
 */
export function unavailable(reason = "not fetched") {
  return {
    value: null,
    source: "unavailable",
    fetchedAt: Date.now(),
    confidence: "unavailable",
    reason,
  };
}

/**
 * Shortcut for Yahoo fallback values — marks them as delayed so the UI can
 * show the "⚠ Delayed" badge per Roadmap Phase 2.1.
 *
 * @param {*} value
 * @returns {Provenance}
 */
export function delayed(value, source = "yahoo") {
  return wrap(value, source, "delayed");
}

/**
 * Build a provenance wrapper around a function-returning-value, capturing
 * latency and handling thrown errors as `unavailable` rather than crashing
 * the whole snapshot build.
 *
 * @param {string} source
 * @param {() => Promise<*>} fn
 * @param {Confidence} [confidence="live"]
 * @returns {Promise<Provenance>}
 */
export async function track(source, fn, confidence = "live") {
  const start = Date.now();
  try {
    const value = await fn();
    if (value === null || value === undefined) {
      return { ...unavailable(`${source}: returned null`), latencyMs: Date.now() - start };
    }
    return wrap(value, source, confidence, { latencyMs: Date.now() - start });
  } catch (err) {
    return {
      ...unavailable(`${source}: ${err?.message || "error"}`),
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Whether a provenance field has a usable value. Guards against both
 * explicit `unavailable` and legacy null values.
 */
export function hasValue(field) {
  const v = unwrap(field);
  return v !== null && v !== undefined;
}
