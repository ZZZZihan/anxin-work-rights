import { AsyncLocalStorage } from 'node:async_hooks';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';

/**
 * Call before invoking a graph in a server runtime with nodejs_compat enabled.
 * Wrangler may resolve LangGraph's browser export, which omits the Node entry's
 * AsyncLocalStorage setup. Without it, interrupt() loses its graph context.
 * The upstream initializer keeps an existing instance; repeated calls are safe.
 * No tracing, provider configuration, network I/O, or user state is installed.
 */
export function initializeHarnessRuntime(): void {
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
}
