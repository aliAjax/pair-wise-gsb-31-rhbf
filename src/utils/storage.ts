import { del, get, set } from 'idb-keyval';

import type {
  LocalTransaction,
  PersistedEnvelope,
  TransactionJournal,
  TransactionSnapshot,
  TransactionWrite,
} from '@/types';

const STORAGE_VERSION = 1;
const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 365;
const TRANSACTION_LOCK = 'reswap-local-transaction';

const prefixed = (key: string) => `reswap:${key}`;

export const STORAGE_KEYS = {
  currentUserId: prefixed('current-user-id'),
  users: prefixed('users'),
  items: prefixed('items'),
  exchanges: prefixed('exchanges'),
  transaction: prefixed('transaction-journal'),
  theme: prefixed('theme'),
  lastClean: prefixed('last-clean'),
};

const now = () => Date.now();

const envelope = <T>(payload: T, ttl = DEFAULT_TTL): PersistedEnvelope<T> => ({
  version: STORAGE_VERSION,
  expiresAt: now() + ttl,
  payload,
});

const toPlain = <T>(payload: T): T => JSON.parse(JSON.stringify(payload)) as T;

const isExpired = <T>(data: PersistedEnvelope<T> | null) => {
  if (!data) return false;
  return Boolean(data.expiresAt && data.expiresAt < now());
};

const parseLocal = <T>(key: string): PersistedEnvelope<T> | null => {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedEnvelope<T>;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
};

const writeLocal = <T>(key: string, payload: T, ttl?: number) => {
  localStorage.setItem(key, JSON.stringify(envelope(payload, ttl)));
};

const readEnvelope = async <T>(key: string): Promise<PersistedEnvelope<T> | null> => {
  return parseLocal<T>(key) ?? ((await get<PersistedEnvelope<T> | null>(key)) ?? null);
};

const writeEnvelope = async (key: string, packed: PersistedEnvelope<unknown>) => {
  localStorage.setItem(key, JSON.stringify(packed));
  await set(key, packed);
};

const readJournal = (): TransactionJournal | null => {
  const raw = localStorage.getItem(STORAGE_KEYS.transaction);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TransactionJournal;
  } catch {
    localStorage.removeItem(STORAGE_KEYS.transaction);
    return null;
  }
};

const writeJournal = (journal: TransactionJournal) => {
  localStorage.setItem(STORAGE_KEYS.transaction, JSON.stringify(journal));
};

class ConcurrencyError extends Error {
  constructor() {
    super('本地数据已被其他窗口更新，正在重试事务');
    this.name = 'ConcurrencyError';
  }
}

const runExclusively = async <T>(task: () => Promise<T>): Promise<T> => {
  const locks = navigator.locks;
  if (locks) {
    return locks.request(TRANSACTION_LOCK, task);
  }
  return task();
};

export const storage = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const localEnvelope = parseLocal<T>(key);
    if (isExpired(localEnvelope)) {
      await this.remove(key);
      return fallback;
    }
    if (localEnvelope?.version === STORAGE_VERSION) {
      return localEnvelope.payload;
    }

    const indexedEnvelope = await get<PersistedEnvelope<T>>(key);
    if (isExpired(indexedEnvelope ?? null)) {
      await this.remove(key);
      return fallback;
    }
    if (indexedEnvelope?.version === STORAGE_VERSION) {
      writeLocal(key, indexedEnvelope.payload);
      return indexedEnvelope.payload;
    }
    return fallback;
  },

  async set<T>(key: string, payload: T, ttl?: number): Promise<T> {
    const plainPayload = toPlain(payload);
    const packed = envelope(plainPayload, ttl);
    localStorage.setItem(key, JSON.stringify(packed));
    await set(key, packed);
    return plainPayload;
  },

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
    await del(key);
  },

  async recoverPendingTransactions(): Promise<void> {
    const journal = readJournal();
    if (!journal) return;

    if (journal.phase === 'committed') {
      for (const write of journal.writes) {
        const packed = envelope(write.payload, write.ttl);
        await writeEnvelope(write.key, packed);
      }
      localStorage.removeItem(STORAGE_KEYS.transaction);
      return;
    }

    for (const snapshot of journal.snapshots) {
      if (snapshot.existed && snapshot.payload) {
        await writeEnvelope(snapshot.key, snapshot.payload as PersistedEnvelope<unknown>);
      } else {
        await this.remove(snapshot.key);
      }
    }
    localStorage.removeItem(STORAGE_KEYS.transaction);
  },

  async transaction<T>(
    worker: (tx: LocalTransaction<T | undefined>) => Promise<void> | void,
  ): Promise<T | undefined> {
    await this.recoverPendingTransactions();

    const runOnce = (): Promise<T | undefined> =>
      runExclusively(async () => {
        const keys = new Set<string>([STORAGE_KEYS.items, STORAGE_KEYS.exchanges]);
        const staged = new Map<string, unknown>();
        const writes: TransactionWrite[] = [];
        let result: T | undefined;
        let resultSet = false;

        const tx: LocalTransaction<T | undefined> = {
          async get<Data>(key: string, fallback: Data): Promise<Data> {
            keys.add(key);
            if (staged.has(key)) return staged.get(key) as Data;
            const packed = await readEnvelope<Data>(key);
            return packed?.version === STORAGE_VERSION ? packed.payload : fallback;
          },
          set<Data>(key: string, payload: Data, ttl?: number) {
            keys.add(key);
            const plainPayload = toPlain(payload);
            staged.set(key, plainPayload);
            writes.push({ key, payload: plainPayload, ttl });
          },
          conflict(): never {
            throw new ConcurrencyError();
          },
          result(value: T | undefined) {
            result = value;
            resultSet = true;
          },
        };

        await worker(tx);

        const snapshots: TransactionSnapshot[] = [];
        for (const key of Array.from(keys)) {
          const packed = await readEnvelope(key);
          const lastWrite = [...writes].reverse().find((write) => write.key === key);
          if (lastWrite) {
            if (packed && JSON.stringify(packed.payload) !== JSON.stringify(lastWrite.payload)) {
              throw new ConcurrencyError();
            }
          }
          snapshots.push({
            key,
            payload: packed,
            existed: Boolean(packed),
          });
        }

        const journal: TransactionJournal = {
          id: this.createId('tx'),
          phase: 'prepared',
          writes,
          snapshots,
          createdAt: new Date().toISOString(),
        };
        writeJournal(journal);

        journal.phase = 'committed';
        journal.committedAt = new Date().toISOString();
        writeJournal(journal);

        for (const write of writes) {
          await writeEnvelope(write.key, envelope(write.payload, write.ttl));
        }
        localStorage.removeItem(STORAGE_KEYS.transaction);

        return resultSet ? result : undefined;
      });

    try {
      return await runOnce();
    } catch (error) {
      if (error instanceof ConcurrencyError) {
        await this.recoverPendingTransactions();
        return runOnce();
      }
      await this.recoverPendingTransactions();
      throw error;
    }
  },

  async cleanExpired(): Promise<void> {
    const keys = Object.values(STORAGE_KEYS).filter((key) => key !== STORAGE_KEYS.transaction);
    await Promise.all(
      keys.map(async (key) => {
        const localEnvelope = parseLocal<unknown>(key);
        if (isExpired(localEnvelope)) {
          await this.remove(key);
        }
      }),
    );
    localStorage.setItem(STORAGE_KEYS.lastClean, JSON.stringify(envelope(new Date().toISOString())));
  },

  createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
  },
};
