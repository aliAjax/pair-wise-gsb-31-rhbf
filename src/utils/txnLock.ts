import { STORAGE_KEYS, storage } from './storage';

/**
 * 跨窗口互斥：同一时刻只允许一个浏览器窗口提交交换事务，
 * 避免“两个窗口同时答应同一物品”各自读到旧数据、互相覆盖。
 *
 * 优先使用 Web Locks API（同源跨标签页，且自动防死锁）；
 * 不支持的环境退化为“页内 Promise 队列 + localStorage 自旋锁”。
 */

interface LockRecord {
  owner: string;
  expiresAt: number;
}

const LOCK_TTL = 1000 * 15;
const RETRY_DELAY = 60;

type LockManagerLike = {
  request: <R>(name: string, cb: () => Promise<R> | R) => Promise<R>;
};

const hasWebLocks = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const locks = (navigator as { locks?: LockManagerLike }).locks;
  return Boolean(locks && typeof locks.request === 'function');
};

const newOwner = () =>
  `${Date.now()}_${Math.random().toString(16).slice(2)}_${crypto.randomUUID?.() ?? ''}`;

// 页内队列：即使退化实现也保证同一标签页内事务串行
let inFlight: Promise<unknown> = Promise.resolve();

const acquireLocalStorageLock = async (): Promise<string> => {
  const owner = newOwner();
  for (;;) {
    const existing = await storage.getRaw<LockRecord>(STORAGE_KEYS.txnLock);
    const stale = !existing || existing.expiresAt < Date.now();
    if (stale) {
      const next: LockRecord = { owner, expiresAt: Date.now() + LOCK_TTL };
      await storage.setRaw(STORAGE_KEYS.txnLock, next);
      // 再读一次，防止两个窗口都判定过期后互相覆盖
      const confirmed = await storage.getRaw<LockRecord>(STORAGE_KEYS.txnLock);
      if (confirmed?.owner === owner) return owner;
    }
    await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY));
  }
};

const releaseLocalStorageLock = async (owner: string) => {
  const current = await storage.getRaw<LockRecord>(STORAGE_KEYS.txnLock);
  if (current?.owner === owner) {
    await storage.removeRaw(STORAGE_KEYS.txnLock);
  }
};

export const withTransactionLock = async <T>(task: () => Promise<T>): Promise<T> => {
  const run = async (): Promise<T> => {
    if (hasWebLocks()) {
      const locks = (navigator as { locks: LockManagerLike }).locks;
      return locks.request<T>('reswap:exchange-txn', task);
    }
    const owner = await acquireLocalStorageLock();
    try {
      return await task();
    } finally {
      await releaseLocalStorageLock(owner);
    }
  };

  // 串到页内队列尾部，保证同页调用也严格按序执行
  const previous = inFlight.then(run, run);
  inFlight = previous.catch(() => undefined);
  return previous;
};
