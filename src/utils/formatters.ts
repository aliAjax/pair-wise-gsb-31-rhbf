import dayjs from 'dayjs';

import { ExchangeConflictReason, ExchangeStatus } from '@/constants/exchange';
import { ItemCondition, ItemStatus } from '@/constants/item';
import { STATUS_MESSAGE_MAP } from '@/constants/messages';
import type { Exchange } from '@/models/exchange';

export const formatDate = (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm');

export const formatItemStatus = (status: ItemStatus) => {
  const map: Record<ItemStatus, string> = {
    [ItemStatus.AVAILABLE]: '可交换',
    [ItemStatus.BOOKED]: '占用中',
    [ItemStatus.EXCHANGED]: '已交换',
    [ItemStatus.OFFLINE]: '已下架',
  };
  return map[status];
};

export const formatExchangeStatus = (status: ExchangeStatus) => {
  const map: Record<ExchangeStatus, string> = {
    [ExchangeStatus.PENDING]: '待确认',
    [ExchangeStatus.ACCEPTED]: '已同意',
    [ExchangeStatus.REJECTED]: '已拒绝',
    [ExchangeStatus.COMPLETED]: '已完成',
    [ExchangeStatus.CONFLICTED]: '冲突作废',
  };
  return map[status];
};

export const formatConflictReason = (reason: ExchangeConflictReason) => {
  const map: Record<ExchangeConflictReason, string> = {
    [ExchangeConflictReason.ITEM_BOOKED]: '物品已被其他交换占用',
    [ExchangeConflictReason.ITEM_EXCHANGED]: '物品已完成交换',
    [ExchangeConflictReason.ITEM_OFFLINE]: '物品已下架',
    [ExchangeConflictReason.VERSION_MISMATCH]: '物品版本已变化，确认依据过期',
    [ExchangeConflictReason.OPEN_HOLD]: '物品存在未结占用',
  };
  return map[reason];
};

export const formatCondition = (condition: ItemCondition) => {
  const map: Record<ItemCondition, string> = {
    [ItemCondition.NEW]: '全新',
    [ItemCondition.LIKE_NEW]: '九成新',
    [ItemCondition.GOOD]: '八成新',
    [ItemCondition.WORN]: '战损',
  };
  return map[condition];
};

export const formatCreditLevel = (score: number) => {
  if (score >= 90) return '守约达人';
  if (score >= 75) return '稳定交换';
  if (score >= 60) return '新晋用户';
  return '需谨慎';
};

export const statusToneClass = (status: ItemStatus | ExchangeStatus) => {
  if (status === ItemStatus.AVAILABLE || status === ExchangeStatus.ACCEPTED) return 'status-good';
  if (status === ItemStatus.BOOKED) return 'status-booked';
  if (status === ItemStatus.OFFLINE || status === ExchangeStatus.REJECTED) return 'status-muted';
  if (status === ItemStatus.EXCHANGED || status === ExchangeStatus.COMPLETED) return 'status-done';
  if (status === ExchangeStatus.CONFLICTED) return 'status-conflict';
  return 'status-wait';
};

export const formatStatusMessage = (status: ItemStatus | ExchangeStatus) => STATUS_MESSAGE_MAP[status];

/** 列表/详情共用：占用对象文案，如“占用中 · 林小雨 ↔ 青禾” */
export const formatHoldTarget = (
  item: { hold_exchange_id: string | null } | undefined,
  exchanges: Exchange[],
  nicknameOf: (userId: string) => string | undefined,
) => {
  if (!item?.hold_exchange_id) return '';
  const exchange = exchanges.find((entry) => entry.id === item.hold_exchange_id);
  if (!exchange) return '占用信息缺失';
  const from = nicknameOf(exchange.from_user_id) ?? exchange.from_user_id;
  const to = nicknameOf(exchange.to_user_id) ?? exchange.to_user_id;
  const prefix = exchange.status === ExchangeStatus.COMPLETED ? '已交换给' : '占用交换';
  return `${prefix} ${from} ↔ ${to}`;
};

/** 冲突结果文案：原因 + 胜方交换，供列表与详情展示 */
export const formatConflictResult = (exchange: Exchange) => {
  if (exchange.status !== ExchangeStatus.CONFLICTED || !exchange.conflict) return '';
  return `${formatConflictReason(exchange.conflict.reason)}，有效交换 ${exchange.conflict.winner_exchange_id}`;
};
