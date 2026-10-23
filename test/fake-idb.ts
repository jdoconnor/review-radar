/**
 * A tiny in-memory IndexedDB stand-in for cache tests.
 *
 * happy-dom has no IndexedDB, so the cache normally exercises its memory
 * fallback. Tests that need the durable path (quota failures, cursor pruning,
 * cross-tab re-reads) install this factory instead. It implements only the
 * slice of the API `src/lib/cache.ts` uses, with asynchronous callbacks that
 * follow the same ordering as a real database: request callbacks first,
 * transaction completion afterwards.
 */

type AnyRequest = {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
  onblocked?: (() => void) | null;
};

export interface FakeIndexedDb {
  factory: IDBFactory;
  /** Stored entries, keyed by their `key` property. Seed it to control contents. */
  store: Map<string, { key: string; value: unknown; lastUsedAt: number }>;
  /** Fail every subsequent `put` with a QuotaExceededError. */
  failPuts(fail: boolean): void;
  /** Fail the next `count` puts, then succeed again. */
  failNextPuts(count: number): void;
  /** Drop all stored entries. */
  reset(): void;
}

function quotaError(): DOMException {
  return new DOMException("Quota exceeded", "QuotaExceededError");
}

export function installFakeIndexedDb(): FakeIndexedDb {
  const data = new Map<string, { key: string; value: unknown; lastUsedAt: number }>();
  let failing = false;
  let remainingFailures = 0;

  function shouldFail(): boolean {
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      return true;
    }
    return failing;
  }

  class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private failed = false;

    objectStore(_name: string): FakeObjectStore {
      return new FakeObjectStore(this);
    }

    finish(): void {
      // Timers run after every queued request callback, which is where a real
      // transaction commits.
      setTimeout(() => {
        if (!this.failed) this.oncomplete?.();
      }, 0);
    }

    fail(): void {
      this.failed = true;
      setTimeout(() => this.onerror?.(), 0);
    }
  }

  class FakeObjectStore {
    constructor(private readonly tx: FakeTransaction) {}

    private request(): AnyRequest {
      return {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
      };
    }

    put(value: { key: string }): AnyRequest {
      const request = this.request();
      if (shouldFail()) {
        queueMicrotask(() => {
          request.error = quotaError();
          request.onerror?.();
        });
        this.tx.fail();
        return request;
      }
      data.set(value.key, value as { key: string; value: unknown; lastUsedAt: number });
      queueMicrotask(() => {
        request.result = value.key;
        request.onsuccess?.();
      });
      this.tx.finish();
      return request;
    }

    get(key: string): AnyRequest {
      const request = this.request();
      queueMicrotask(() => {
        request.result = data.get(key);
        request.onsuccess?.();
      });
      this.tx.finish();
      return request;
    }

    delete(key: string): AnyRequest {
      const request = this.request();
      data.delete(key);
      queueMicrotask(() => request.onsuccess?.());
      this.tx.finish();
      return request;
    }

    clear(): AnyRequest {
      const request = this.request();
      data.clear();
      queueMicrotask(() => request.onsuccess?.());
      this.tx.finish();
      return request;
    }

    count(): AnyRequest {
      const request = this.request();
      queueMicrotask(() => {
        request.result = data.size;
        request.onsuccess?.();
      });
      this.tx.finish();
      return request;
    }

    openCursor(): AnyRequest {
      const request = this.request();
      const entries = [...data.values()];
      let index = 0;
      const step = (): void => {
        queueMicrotask(() => {
          if (index >= entries.length) {
            request.result = null;
            request.onsuccess?.();
            return;
          }
          const entry = entries[index];
          index += 1;
          if (!entry) return;
          request.result = {
            value: entry,
            delete: () => data.delete(entry.key),
            continue: step,
          };
          request.onsuccess?.();
        });
      };
      step();
      this.tx.finish();
      return request;
    }
  }

  const db = {
    objectStoreNames: { contains: (name: string) => name === "responses" },
    createObjectStore: () => ({}),
    transaction: () => new FakeTransaction(),
    close: () => undefined,
  };

  const factory = {
    open: () => {
      const request: AnyRequest = { result: db, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  return {
    factory: factory as unknown as IDBFactory,
    store: data,
    failPuts: (fail: boolean) => {
      failing = fail;
      remainingFailures = 0;
    },
    failNextPuts: (count: number) => {
      remainingFailures = count;
    },
    reset: () => {
      data.clear();
      failing = false;
      remainingFailures = 0;
    },
  };
}
