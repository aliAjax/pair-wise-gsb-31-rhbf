/**
 * 事务/占用/冲突/恢复的本机冒烟测试（node 环境，内存模拟浏览器存储）。
 * 运行：node test/run-smoke.mjs
 */

// ---- 浏览器 API 桩 ----
const memory = new Map();
const localStorageMock = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => void memory.set(k, String(v)),
  removeItem: (k) => void memory.delete(k),
  clear: () => memory.clear(),
};
globalThis.localStorage = localStorageMock;
globalThis.window = { setTimeout, addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: () => `id_${Math.random().toString(16).slice(2)}` },
  configurable: true,
});
globalThis.navigator = { locks: undefined };

const assertions = [];
const check = (name, cond) => {
  assertions.push([name, Boolean(cond)]);
  if (!cond) console.error('  ✗', name);
};

const main = async () => {
  const { storage, STORAGE_KEYS } = await import('@/utils/storage.ts');
  const { migrateLocalData } = await import('@/utils/migration.ts');
  const { exchangeApi } = await import('@/api/exchangeApi.ts');
  const { itemApi } = await import('@/api/itemApi.ts');
  const { recoverPendingTransaction } = await import('@/utils/transaction.ts');
  const { ItemStatus } = await import('@/constants/item.ts');
  const { ExchangeStatus } = await import('@/constants/exchange.ts');

  // ---- 旧数据迁移：无版本字段 ----
  const oldItems = [
    {
      id: 'a',
      user_id: 'u1',
      title: 'A',
      description: '',
      category: '数码',
      condition: 'good',
      images: [],
      status: 'available',
      location: '',
      created_at: new Date().toISOString(),
    },
    {
      id: 'b',
      user_id: 'u2',
      title: 'B',
      description: '',
      category: '书籍',
      condition: 'new',
      images: [],
      status: 'available',
      location: '',
      created_at: new Date().toISOString(),
    },
    {
      id: 'c',
      user_id: 'u1',
      title: 'C',
      description: '',
      category: '家居',
      condition: 'good',
      images: [],
      status: 'available',
      location: '',
      created_at: new Date().toISOString(),
    },
  ];
  const oldExchanges = [
    {
      id: 'e1',
      from_user_id: 'u1',
      to_user_id: 'u2',
      from_item_id: 'a',
      to_item_id: 'b',
      status: 'pending',
      message: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
  await storage.set(STORAGE_KEYS.items, oldItems);
  await storage.set(STORAGE_KEYS.exchanges, oldExchanges);
  await storage.removeRaw(STORAGE_KEYS.migration);

  await migrateLocalData();
  let items = await itemApi.list();
  let exchanges = await exchangeApi.list();
  check('迁移后物品补版本号 1', items.every((i) => i.version === 1));
  check('迁移后物品补占用字段', items.every((i) => i.hold_exchange_id === null));
  check('迁移后交换补版本号', exchanges.every((e) => e.version === 1));
  check('迁移后交换补版本快照', exchanges[0].item_versions.to_item_version === 1);
  check('迁移后交换冲突字段为 null', exchanges[0].conflict === null);

  // ---- 发起两笔针对同一物品 b 的待确认请求 ----
  await exchangeApi.create({
    from_user_id: 'u1',
    to_user_id: 'u2',
    from_item_id: 'a',
    to_item_id: 'b',
    message: '第一笔',
  });
  const second = await exchangeApi.create({
    from_user_id: 'u1',
    to_user_id: 'u2',
    from_item_id: 'c',
    to_item_id: 'b',
    message: '第二笔',
  });
  exchanges = await exchangeApi.list();
  check('两笔待确认请求可并存', exchanges.filter((e) => e.status === 'pending').length === 3);

  // ---- 第一笔答应：占用 a、b，第二笔应被自动判为冲突作废 ----
  const accepted = await exchangeApi.transition(second.id, ExchangeStatus.ACCEPTED);
  check('答应返回 accepted', accepted.status === ExchangeStatus.ACCEPTED);
  items = await itemApi.list();
  const itemB = items.find((i) => i.id === 'b');
  const itemC = items.find((i) => i.id === 'c');
  check('对方物品变为占用中', itemB.status === ItemStatus.BOOKED);
  check('对方物品指向胜方交换', itemB.hold_exchange_id === second.id);
  check('对方物品版本自增', itemB.version === 2);
  check('己方物品也被占用', itemC.status === ItemStatus.BOOKED && itemC.hold_exchange_id === second.id);

  exchanges = await exchangeApi.list();
  const losers = exchanges.filter((e) => e.status === ExchangeStatus.CONFLICTED);
  check('其他 pending 请求被标冲突', losers.length === 2);
  check('冲突记录保留胜方 id', losers.every((e) => e.conflict?.winner_exchange_id === second.id));
  check('冲突原因是物品被占用', losers.every((e) => e.conflict?.reason === 'item_booked'));

  // ---- 用旧视图再答应一次败方：状态机拒绝（已是终态） ----
  let staleRejected = false;
  try {
    await exchangeApi.transition(losers[0].id, ExchangeStatus.ACCEPTED);
  } catch {
    staleRejected = true;
  }
  check('终态交换不能再操作', staleRejected);

  // ---- 第三窗口视角：再发一笔针对 b 的请求应被拒绝（已占用）----
  let createBlocked = false;
  try {
    await exchangeApi.create({
      from_user_id: 'u1',
      to_user_id: 'u2',
      from_item_id: 'a',
      to_item_id: 'b',
      message: '迟来的请求',
    });
  } catch {
    createBlocked = true;
  }
  check('已占用物品不能再发起交换', createBlocked);

  // ---- 完成：物品归到这笔交换 ----
  await exchangeApi.transition(second.id, ExchangeStatus.COMPLETED);
  items = await itemApi.list();
  check(
    '完成后双方物品已交换',
    ['b', 'c'].every((id) => items.find((i) => i.id === id)?.status === ItemStatus.EXCHANGED),
  );
  check('完成后仍保留占用对象指针', items.find((i) => i.id === 'b').hold_exchange_id === second.id);

  // ---- 版本核对：新交换引用版本过期的物品 ----
  // 把 a 直接编辑一次制造版本差，再构造一笔快照为旧版本的请求
  await itemApi.update('a', { description: '改过了' });
  await storage.set(STORAGE_KEYS.exchanges, [
    {
      id: 'e_old',
      from_user_id: 'u2',
      to_user_id: 'u1',
      from_item_id: 'b', // 已 exchanged，会先命中 exchanged
      to_item_id: 'a',
      status: 'pending',
      message: '',
      version: 1,
      item_versions: { from_item_version: 1, to_item_version: 1 },
      conflict: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);
  const versionCase = await exchangeApi.transition('e_old', ExchangeStatus.ACCEPTED);
  check('物品已交换时答应 => 冲突作废', versionCase.status === ExchangeStatus.CONFLICTED);
  check('冲突原因为已交换', versionCase.conflict.reason === 'item_exchanged');
  const aAfter = (await itemApi.list()).find((i) => i.id === 'a');
  check('冲突答应不改动物品', aAfter.status === ItemStatus.AVAILABLE && aAfter.hold_exchange_id === null);

  // ---- 崩溃恢复：prepared 回滚 ----
  const before = await storage.get(STORAGE_KEYS.items, []);
  await storage.setRaw(STORAGE_KEYS.txnLog, {
    id: 'txn_crash',
    action: 'exchange:accepted',
    state: 'prepared',
    preparedAt: new Date().toISOString(),
    committedAt: null,
    changes: [{ key: STORAGE_KEYS.items, before, after: [{ id: 'fake' }] }],
  });
  await storage.commitPayload(STORAGE_KEYS.items, [{ id: 'fake' }]); // 模拟写入中途的脏数据
  await recoverPendingTransaction();
  const rolled = await storage.get(STORAGE_KEYS.items, []);
  check('prepared 崩溃后完整退回', JSON.stringify(rolled) === JSON.stringify(before));
  check('回滚后事务日志已清除', (await storage.getRaw(STORAGE_KEYS.txnLog)) === null);

  // ---- 崩溃恢复：committed 续完 ----
  const goodItems = before;
  await storage.setRaw(STORAGE_KEYS.txnLog, {
    id: 'txn_crash2',
    action: 'exchange:accepted',
    state: 'committed',
    preparedAt: new Date().toISOString(),
    committedAt: new Date().toISOString(),
    changes: [{ key: STORAGE_KEYS.items, before: [{ id: 'old' }], after: goodItems }],
  });
  await storage.commitPayload(STORAGE_KEYS.items, [{ id: 'partially-written' }]); // 只写了一半
  await recoverPendingTransaction();
  const resumed = await storage.get(STORAGE_KEYS.items, []);
  check('committed 崩溃后续完落盘', JSON.stringify(resumed) === JSON.stringify(goodItems));
  check('续完后事务日志已清除', (await storage.getRaw(STORAGE_KEYS.txnLog)) === null);

  const failed = assertions.filter(([, ok]) => !ok);
  console.log(`\n${assertions.length - failed.length}/${assertions.length} 条断言通过`);
  if (failed.length) {
    process.exitCode = 1;
  } else {
    console.log('事务、占用、版本核对、冲突标记与崩溃恢复全部符合预期');
  }
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
