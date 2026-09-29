import type { TransactionKey, TransactionLog } from '@/types';

import { STORAGE_KEYS, storage } from './storage';
import { withTransactionLock } from './txnLock';

/**
 * 可恢复的本机事务（write-ahead log + 跨窗口互斥）。
 *
 * 一个事务的生命周期：
 *   1. prepare：读取改前快照，执行变更函数，把「改前 / 改后」整体写入日志；
 *   2. commit：把改后结果逐键落盘（localStorage + IndexedDB），日志标记 committed；
 *   3. 清理：删除日志。
 *
 * 写入中断后重开浏览器，recoverPendingTransaction() 保证：
 *   - prepared：从未提交，用改前快照完整退回；
 *   - committed：已经提交，按改后结果续完落盘。
 */

export interface TransactionContext {
  /** 事务内读取的最新集合快照（已持有跨窗口锁，读到的就是当前权威数据） */
  read: <T>(key: TransactionKey, fallback: T) => Promise<T>;
}

export interface TransactionChange<T> {
  key: TransactionKey;
  before: T;
  after: T;
}

const loadLog = (): Promise<TransactionLog | null> => storage.getRaw<TransactionLog>(STORAGE_KEYS.txnLog);

const saveLog = async (log: TransactionLog): Promise<void> => {
  await storage.setRaw(STORAGE_KEYS.txnLog, log);
};

export const runTransaction = async <T>(
  action: string,
  task: (ctx: TransactionContext) => Promise<{ result: T; changes: TransactionChange<unknown>[] }>,
): Promise<T> => {
  return withTransactionLock(async () => {
    // 提交前先处理上次中断遗留的事务，保证起点一致
    await recoverPendingTransaction();

    const read = <U>(key: TransactionKey, fallback: U) => storage.get<U>(key, fallback);

    const { result, changes } = await task({ read });

    // 1) prepare：before/after 整体落盘，之后崩溃也能退回到 before
    const log: TransactionLog = {
      id: storage.createId('txn'),
      action,
      state: 'prepared',
      preparedAt: new Date().toISOString(),
      committedAt: null,
      changes: changes.map((change) => ({
        key: change.key,
        before: change.before,
        after: change.after,
      })),
    };
    await saveLog(log);

    // 2) commit：逐键写入新数据
    for (const change of log.changes) {
      await storage.commitPayload(change.key, change.after);
    }

    // 3) 标记已提交。若在逐键写入后、此处之前崩溃，恢复时会按 after 续写完
    await saveLog({ ...log, state: 'committed', committedAt: new Date().toISOString() });

    // 4) 清理日志
    await storage.removeRaw(STORAGE_KEYS.txnLog);
    return result;
  });
};

/**
 * 启动时（以及每次拿锁后）恢复中断事务。
 * 返回本次恢复做了什么，供启动提示使用。
 */
export const recoverPendingTransaction = async (): Promise<{
  resumed: TransactionLog | null;
  rolledBack: TransactionLog | null;
}> => {
  const log = await loadLog();
  if (!log) return { resumed: null, rolledBack: null };

  if (log.state === 'committed') {
    // 续完：确保每个键的改后结果都已落盘
    for (const change of log.changes) {
      await storage.commitPayload(change.key, change.after);
    }
    await storage.removeRaw(STORAGE_KEYS.txnLog);
    return { resumed: log, rolledBack: null };
  }

  // prepared：从未对外提交，完整退回到改前快照
  for (const change of log.changes) {
    await storage.commitPayload(change.key, change.before);
  }
  await storage.removeRaw(STORAGE_KEYS.txnLog);
  return { resumed: null, rolledBack: log };
};
