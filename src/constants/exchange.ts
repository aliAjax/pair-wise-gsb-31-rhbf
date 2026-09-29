export enum ExchangeStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
  CONFLICTED = 'conflicted',
}

export enum ExchangeConflictReason {
  ITEM_CHANGED = 'item_version_changed',
  ITEM_OCCUPIED = 'item_already_occupied',
  ITEM_UNAVAILABLE = 'item_unavailable',
  EXCHANGE_CHANGED = 'exchange_version_changed',
}

export const EXCHANGE_STATUS_OPTIONS = [
  { label: '待确认', value: ExchangeStatus.PENDING },
  { label: '已同意', value: ExchangeStatus.ACCEPTED },
  { label: '已拒绝', value: ExchangeStatus.REJECTED },
  { label: '已完成', value: ExchangeStatus.COMPLETED },
  { label: '冲突失效', value: ExchangeStatus.CONFLICTED },
];

export const EXCHANGE_ACTION_FLOW: Record<ExchangeStatus, ExchangeStatus[]> = {
  [ExchangeStatus.PENDING]: [ExchangeStatus.ACCEPTED, ExchangeStatus.REJECTED, ExchangeStatus.CONFLICTED],
  [ExchangeStatus.ACCEPTED]: [ExchangeStatus.COMPLETED, ExchangeStatus.CONFLICTED],
  [ExchangeStatus.REJECTED]: [],
  [ExchangeStatus.COMPLETED]: [],
  [ExchangeStatus.CONFLICTED]: [],
};

export const EXCHANGE_STORAGE_HINTS = {
  statusKey: 'reswap:exchanges',
  statusTouchedBy: ['models/exchange.ts', 'stores/exchangeStore.ts', 'components/common/ExchangeCard.vue'],
};
