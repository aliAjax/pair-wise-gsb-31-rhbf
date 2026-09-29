import type { InjectionKey, ComputedRef } from 'vue';
import type { Exchange } from '@/models/exchange';

/** App 层提供的全局交换快照，供 ItemCard 等深层组件展示占用对象 */
export const EXCHANGES_KEY: InjectionKey<ComputedRef<Exchange[]>> = Symbol('reswap:exchanges');

/** App 层提供的昵称查询，供占用/冲突文案复用 */
export const NICKNAME_KEY: InjectionKey<(userId: string) => string | undefined> = Symbol(
  'reswap:nickname',
);
