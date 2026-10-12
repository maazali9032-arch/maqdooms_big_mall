/** Bound remote logout so a slow server cannot indefinitely block account switching. */
export const AUTH_LOGOUT_TIMEOUT_MS = 5000;
export function withLogoutTimeout(
  fetcher: typeof fetch,
  timeoutMs = AUTH_LOGOUT_TIMEOUT_MS,
): typeof fetch {
  return (input, init) => {
    const url =
      typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
    if (!/\/auth\/v1\/logout(?:\?|$)/.test(url)) return fetcher(input, init);
    const controller = new AbortController();
    const upstream =
      init?.signal ??
      (typeof Request !== "undefined" && input instanceof Request ? input.signal : null);
    const abort = () => controller.abort();
    if (upstream?.aborted) abort();
    else upstream?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    return (async () => {
      try {
        const response = await fetcher(input, { ...init, signal: controller.signal });
        // Include reading the logout body in the deadline; stalled headers/body
        // must not keep account switching blocked indefinitely.
        await response.clone().arrayBuffer();
        return response;
      } finally {
        clearTimeout(timer);
        upstream?.removeEventListener("abort", abort);
      }
    })();
  };
}
