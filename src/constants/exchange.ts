export enum ExchangeStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
  /** 竞争失败：物品已归属于另一笔有效交换，这笔请求作废并保留冲突结果 */
  CONFLICTED = 'conflicted',
}

/** 冲突原因，决定列表/详情里展示的冲突结果文案 */
export enum ExchangeConflictReason {
  ITEM_BOOKED = 'item_booked',
  ITEM_EXCHANGED = 'item_exchanged',
  ITEM_OFFLINE = 'item_offline',
  VERSION_MISMATCH = 'version_mismatch',
  OPEN_HOLD = 'open_hold',
}

export const EXCHANGE_STATUS_OPTIONS = [
  { label: '待确认', value: ExchangeStatus.PENDING },
  { label: '已同意', value: ExchangeStatus.ACCEPTED },
  { label: '已拒绝', value: ExchangeStatus.REJECTED },
  { label: '已完成', value: ExchangeStatus.COMPLETED },
  { label: '冲突作废', value: ExchangeStatus.CONFLICTED },
];

export const EXCHANGE_ACTION_FLOW: Record<ExchangeStatus, ExchangeStatus[]> = {
  [ExchangeStatus.PENDING]: [
    ExchangeStatus.ACCEPTED,
    ExchangeStatus.REJECTED,
    ExchangeStatus.CONFLICTED,
  ],
  [ExchangeStatus.ACCEPTED]: [ExchangeStatus.COMPLETED, ExchangeStatus.REJECTED],
  [ExchangeStatus.REJECTED]: [],
  [ExchangeStatus.COMPLETED]: [],
  [ExchangeStatus.CONFLICTED]: [],
};

/** 仍占用物品、算“有效交换”的状态 */
export const OPEN_EXCHANGE_STATUSES: ExchangeStatus[] = [ExchangeStatus.ACCEPTED];

/** 物品已被锁定、不能再被另一笔交换占用的状态 */
export const SETTLED_EXCHANGE_STATUSES: ExchangeStatus[] = [
  ExchangeStatus.ACCEPTED,
  ExchangeStatus.COMPLETED,
];

/** 终态：不再允许任何操作 */
export const TERMINAL_EXCHANGE_STATUSES: ExchangeStatus[] = [
  ExchangeStatus.REJECTED,
  ExchangeStatus.COMPLETED,
  ExchangeStatus.CONFLICTED,
];

export const EXCHANGE_STORAGE_HINTS = {
  statusKey: 'reswap:exchanges',
  transactionKey: 'reswap:txn-log',
  statusTouchedBy: [
    'models/exchange.ts',
    'stores/exchangeStore.ts',
    'components/common/ExchangeCard.vue',
    'utils/migration.ts',
    'utils/transaction.ts',
  ],
};
