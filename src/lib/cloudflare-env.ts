import { AsyncLocalStorage } from "node:async_hooks";

type Env = Record<string, unknown>;

const storage = new AsyncLocalStorage<Env>();

export function runWithCloudflareEnv<T>(
  env: unknown,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run((env ?? {}) as Env, fn);
}

export function getCloudflareEnv(): Env {
  return storage.getStore() ?? {};
}
