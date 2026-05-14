import { AsyncLocalStorage } from "node:async_hooks";

// Captures the Cloudflare Workers ExecutionContext for the current request so
// server functions can schedule background work via waitUntil() and have it
// survive past the HTTP response.
export type WorkerExecutionContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

export const executionContextStorage = new AsyncLocalStorage<WorkerExecutionContext>();

export function runWithExecutionContext<T>(
  ctx: unknown,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const value = (ctx ?? {}) as WorkerExecutionContext;
  return executionContextStorage.run(value, fn);
}

// Schedule background work that should outlive the current response.
// Falls back to a dangling promise if waitUntil is unavailable (e.g. dev /
// non-Cloudflare runtime) — caller code must still handle its own errors.
export function scheduleBackground(promise: Promise<unknown>): void {
  const store = executionContextStorage.getStore();
  if (store?.waitUntil) {
    try {
      store.waitUntil(promise);
      return;
    } catch {
      /* fall through */
    }
  }
  // Best-effort fallback: ensure unhandled rejections are logged.
  promise.catch((err) => console.error("[scheduleBackground] background task failed:", err));
}
