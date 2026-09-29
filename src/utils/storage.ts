import { del, get, set } from 'idb-keyval';

import type { PersistedEnvelope } from '@/types';

const STORAGE_VERSION = 1;
const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 365;

const prefixed = <K extends string>(key: K): `reswap:${K}` => `reswap:${key}`;

export const STORAGE_KEYS = {
  currentUserId: prefixed('current-user-id'),
  users: prefixed('users'),
  items: prefixed('items'),
  exchanges: prefixed('exchanges'),
  theme: prefixed('theme'),
  lastClean: prefixed('last-clean'),
  /** 未完成的本机事务日志（write-ahead log） */
  txnLog: prefixed('txn-log'),
  /** 跨窗口互斥锁，同一时刻只允许一个窗口提交交换事务 */
  txnLock: prefixed('txn-lock'),
  /** 数据结构迁移水位，记录各业务集合已迁移到的版本 */
  migration: prefixed('migration'),
} as const;

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

/** 不带信封的裸写，事务日志/锁等机制数据使用 */
const writeRawLocal = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const readRawLocal = <T>(key: string): T | null => {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
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

  /** 直接读取信封内的业务负载并写入指定集合，供事务提交复用，避免再次打包 */
  async commitPayload<T>(key: string, payload: T): Promise<void> {
    const packed = envelope(toPlain(payload));
    localStorage.setItem(key, JSON.stringify(packed));
    await set(key, packed);
  },

  async getRaw<T>(key: string): Promise<T | null> {
    const local = readRawLocal<T>(key);
    if (local !== null) return local;
    return (await get<T>(key)) ?? null;
  },

  async setRaw<T>(key: string, value: T): Promise<void> {
    const plain = toPlain(value);
    writeRawLocal(key, plain);
    await set(key, plain);
  },

  async removeRaw(key: string): Promise<void> {
    localStorage.removeItem(key);
    await del(key);
  },

  async cleanExpired(): Promise<void> {
    const keys = Object.values(STORAGE_KEYS).filter(
      (key) => key !== STORAGE_KEYS.txnLog && key !== STORAGE_KEYS.txnLock,
    );
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
