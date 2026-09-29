// idb-keyval 的内存桩：node 冒烟测试无 IndexedDB，localStorage 已足够
const store = new Map();
export const get = async (key) => (store.has(key) ? store.get(key) : undefined);
export const set = async (key, value) => {
  store.set(key, value);
};
export const del = async (key) => {
  store.delete(key);
};
export const clear = async () => store.clear();
