# ReSwap 二手闲置物品交换平台

```bash
pnpm install
pnpm dev
```

访问地址：`http://localhost:18415`

## 项目介绍

ReSwap 是一个纯前端以物换物 Web 应用。用户可以本地模拟登录、发布闲置物品、浏览他人物品、发起交换请求，并在浏览器内管理交换记录。

## 主要功能

- 首页瀑布流浏览、分类筛选、关键词搜索。
- 物品详情、物主资料、选择自己的物品发起交换。
- 发布物品，支持本地 base64 图片上传、分类和成色选择。
- 交换管理，区分我发起的和我收到的请求，支持同意、拒绝、完成。
- 个人中心，编辑资料、上传头像、查看我发布的物品。
- 主题切换、全局错误处理和 Vant 提示。

## 启动与构建

```bash
pnpm install
pnpm dev
```

```bash
pnpm build
```

生产部署：执行 `pnpm build` 后，将 `dist/` 目录交给 Nginx 或任意静态文件服务器托管。

## 技术栈

| 类型 | 技术 |
| --- | --- |
| 框架 | Vue 3 + TypeScript |
| 构建 | Vite |
| 状态管理 | Pinia |
| 路由 | Vue Router 4 |
| UI | Vant + Tailwind CSS |
| 持久化 | localStorage + IndexedDB（idb-keyval） |
| 工具库 | dayjs、lodash-es |

## 项目目录结构

```text
src/
├── api/              # userApi.ts, itemApi.ts, exchangeApi.ts：本地数据 API 层
├── stores/           # authStore.ts, itemStore.ts, exchangeStore.ts, themeStore.ts
├── models/           # user.ts, item.ts, exchange.ts：独立数据模型
├── types/            # 共享类型补充
├── components/common/# 共享业务组件和 GlobalErrorBoundary
├── hooks/            # useAuth.ts, useLocalStorage.ts, useExchangeStats.ts, useRemoteChanges.ts
├── pages/            # Home, ItemDetail, Publish, Exchanges, Profile
├── router/           # index.ts + guards.ts
├── utils/            # storage.ts, transaction.ts, txnLock.ts, migration.ts, occupancy.ts, formatters.ts, validators.ts, message.ts, themeUtils.ts
├── constants/        # item.ts, exchange.ts, themes.ts, messages.ts
├── App.vue
├── main.ts
└── styles.css
```

## 数据持久化说明

- `utils/storage.ts` 统一封装 localStorage 和 IndexedDB。
- 所有 `api/*Api.ts` 通过 `storage.ts` 读写数据，不在组件里直接写业务数据。
- 存储层包含序列化、版本号、过期清理、存储 key 管理、事务裸读写。
- 首次启动会写入演示用户、物品和交换请求。

### 并发安全与可恢复的本机事务

两个浏览器窗口同时处理同一件闲置时，为避免“一处答应交换、另一处按旧数据再答应、物品状态互相覆盖”，答应/拒绝/完成/发起全部走 `utils/transaction.ts` 的 write-ahead log 本机事务：

- **确认前核对**：同意时在事务内重读双方物品，核对 `version`（发起时快照）与未结占用（`hold_exchange_id`），再决定占用或作废。
- **一物一交换**：同意成功后两件物品置为 `booked` 并写入占用交换 id，其他仍在等待且引用了同一物品的请求自动标记为 `conflicted`，一件物品只能归到一笔有效交换。
- **跨窗口互斥**：`utils/txnLock.ts` 优先用 Web Locks API，退化到 localStorage 自旋锁 + 页内队列；`hooks/useRemoteChanges.ts` 监听 storage 事件，别处提交后本窗口立即刷新。
- **崩溃恢复**：事务先 `prepared`（before/after 整体落日志）后逐键提交再标 `committed`。重开浏览器时 `recoverPendingTransaction()` 保证 committed 续写完、prepared 用 before 完整退回。
- **旧记录迁移**：`utils/migration.ts` 在启动、hydrate 前运行，给缺少 `version` 的物品/交换补版本号，回填 `hold_exchange_id` 与双方物品版本快照，迁移幂等并记录水位（`reswap:migration`）。
- 列表（`ItemCard`）与详情（`ItemDetail`、`ExchangeCard`）显示物品占用对象（交换双方昵称）与冲突结果（原因、胜方交换、冲突物品与时间）。

## 横切关注点

- 主题切换：`stores/themeStore.ts`、`constants/themes.ts`、`utils/themeUtils.ts`、`App.vue`、`components/common/CategoryFilter.vue`、`components/common/UserBrief.vue`、`components/common/ItemCard.vue`。
- 全局错误处理/提示：`utils/message.ts`、`components/common/GlobalErrorBoundary.tsx`、`stores/authStore.ts`、`stores/itemStore.ts`、`stores/exchangeStore.ts`、`components/common/ImageUploader.vue`。

## 枚举出现位置清单

### ItemStatus

定义位置：`src/constants/item.ts`（AVAILABLE / **BOOKED** / EXCHANGED / OFFLINE）

出现位置：

- `src/models/item.ts`
- `src/constants/messages.ts`
- `src/api/itemApi.ts`
- `src/api/exchangeApi.ts`
- `src/stores/itemStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/utils/occupancy.ts`
- `src/utils/migration.ts`
- `src/components/common/ItemCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Publish.vue`
- `src/pages/Profile.vue`

### ExchangeStatus

定义位置：`src/constants/exchange.ts`（PENDING / ACCEPTED / REJECTED / COMPLETED / **CONFLICTED**；另有 `ExchangeConflictReason`）

出现位置：

- `src/models/exchange.ts`
- `src/constants/messages.ts`
- `src/api/exchangeApi.ts`
- `src/stores/exchangeStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/utils/occupancy.ts`
- `src/utils/migration.ts`
- `src/hooks/useExchangeStats.ts`
- `src/components/common/ExchangeCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Exchanges.vue`

## 分层与高耦合约束

本项目保留提示词要求的“严禁合并职责到单一文件”：模型、常量、API、store、页面、组件、hooks、utils 均独立拆分。

同时保留“屎山代码设计要求”的低内聚高耦合特征：

- `utils/formatters.ts` 同时负责日期、物品状态、交换状态、成色、信用等级文本。
- `constants/messages.ts` 同时包含页面提示、表单校验、日志式文案和状态文案。
- `ItemStatus` 与 `ExchangeStatus` 被模型、API、store、组件、页面、router guards、formatters 多处引用。
- `utils/storage.ts` 是存储入口，但全应用 API 和 store 都依赖它的 key 与数据结构。

例如新增 `ItemStatus.BOOKED` 时，应至少修改：`src/constants/item.ts`、`src/models/item.ts`、`src/api/itemApi.ts`、`src/api/exchangeApi.ts`、`src/stores/itemStore.ts`、`src/router/guards.ts`、`src/utils/formatters.ts`、`src/constants/messages.ts`、`src/components/common/ItemCard.vue`、`src/pages/ItemDetail.vue`、`src/pages/Publish.vue` 等文件。

## 环境变量

当前项目无必需环境变量。

## License

MIT
