# Account Progress Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机和电脑登录同一邮箱账号后，共享词卡熟悉度和背诵位置，保留旧记录，并支持断网补同步。

**Architecture:** GitHub Pages 继续托管静态页面，官方 Supabase 客户端连接 Auth 与带行级权限的 PostgreSQL。每张卡单独保存服务端版本，事务 RPC 合并带幂等 ID 的客户端操作。前端保留按账号隔离的缓存与队列；独立离线版不携带账号组件或会话。

**Tech Stack:** Node.js 24.15.0、原生 JavaScript modules、`@supabase/supabase-js@2.118.0`、`esbuild@0.28.2`、`supabase@2.122.0`、PostgreSQL 17、Node test runner、现有 playwright-cli。

---

## 已核实的状态与执行边界

- 工作目录：`D:/雅思听力资料/map-pocket-github`。
- 设计：`docs/superpowers/specs/2026-10-27-account-progress-sync-design.md`，用户已经批准。
- Supabase 授权已实际通过读取组织和项目验证，不再要求用户重复授权。
- 组织：`flyyuan1's Org`，ID `fkgxzhegyntcovcvsvxe`，当前 Free 方案。
- 优先复用 `ielts-practice`，项目 ID `hgdnugbunlmhaaackqjc`，东京区域，目前 `INACTIVE`。该选择不包含删除旧表、重置项目或更改其他应用的认证流程。
- 另一个项目 `boss-training-simulator` 与本任务无关，不修改。
- 现有项目恢复后，先读表结构、认证配置和健康信息。若项目正在承载不兼容的业务或邮件配置不能用于本站，先说明具体差异再调整接入方式，不直接覆盖配置。
- 不新建项目、不升级方案、不创建计费分支。若复用条件不满足，另行核实费用和用户选择。
- 项目管理工具没有认证配置读取/写入接口。需要配置时，使用已登录的官方控制台；只有控制台明确要求用户登录或提供发信服务时才请求必要输入。密码和 SMTP 凭据不通过聊天收集、不提交到仓库。
- 现有 SDK 版本与 Node 版本兼容。已读取 Supabase 更新索引：近期旧 TLS 密码套件弃用不影响当前浏览器目标；免费项目邮件模板限制不通过定制邮件模板绕过。
- 本文件当前只是计划，尚未恢复项目、安装依赖或修改产品代码。

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| `index.html` | 保留当前学习页面，加入账号入口和学习状态桥接，不重写词库 |
| `offline.html` | 保留当前独立离线版，不加入账号依赖 |
| `account/core.mjs` | 进度格式校验、状态差异、保守冲突合并 |
| `account/storage.mjs` | 旧数据备份、按账号缓存、持久化队列和迁移状态 |
| `account/sync.mjs` | 拉取、补传、版本、认证切换隔离、单飞与退避 |
| `account/auth.mjs` | 官方客户端初始化与认证调用 |
| `account/ui.mjs` | 账号对话框、登录/注册/找回表单和同步提示 |
| `account/main.mjs` | 页面桥接、认证事件、联网/焦点/轮询生命周期 |
| `account/account.css` | 跟随现有字号配色的账号界面样式 |
| `account/config.json` | 仅公开项目 URL 与 publishable key；不保存管理密钥 |
| `assets/account.js` | esbuild 生成的浏览器包，内含官方 SDK |
| `scripts/build-account.mjs` | 固定版本打包，构建独立离线下载内容 |
| `tests/core.test.mjs` | 差异、合并、输入校验 |
| `tests/storage.test.mjs` | 队列持久化、备份、账号分区 |
| `tests/sync.test.mjs` | 并发、重试、旧响应、切换账号、断网 |
| `tests/auth-browser.mjs` | 双会话账号、移动端、离线下载集成验证 |
| `supabase/migrations/` | CLI 生成文件名的迁移，独立的 pocket 表和事务函数 |
| `docs/account-sync-verification.md` | 记录实际验证结果与尚需用户设备验证的项目 |

## Task 1：确认后端可用及现有配置

**涉及：** Supabase 管理读取、官方控制台；不改学习页面。

- [ ] 恢复项目 `hgdnugbunlmhaaackqjc`，用项目状态确认恢复完成。恢复失败时读取确切错误，不反复恢复。
- [ ] 读取 `public` 表结构、迁移记录、安全/性能建议，记录现有表名和依赖；禁止对旧表执行 DROP、TRUNCATE、RESET。
- [ ] 查询项目 URL 和 publishable keys；优先选择 modern publishable key。不要索取 service role key 来替代权限设计。
- [ ] 读取公开认证设置及控制台配置，确认邮箱密码登录、注册策略、现有 Site URL、追加重定向 URL 和 SMTP 状态。
- [ ] 保留现有应用 Site URL，不擅自替换；在允许列表中精确追加 `https://flyyuan1.github.io/ielts-map-pocket/`。客户端每次明确传入本站回跳地址。
- [ ] 验证注册、验证邮件和找回密码的发信能力。默认邮件服务仅限组织成员地址且有额度限制；不能把它当作任意用户的正式发信服务。没有合适发信配置时，停止开放注册的发布，说明需要补充的具体服务。
- [ ] 测试项目域名 TLS、公开认证设置端点和公开客户端连接。当前机器通过不代表中国移动通过，最终保留手机验证项。

## Task 2：建立可独立验证的进度模型

**创建：** `package.json`、`package-lock.json`、`.gitignore`、`account/core.mjs`、`tests/core.test.mjs`。

- [ ] 写入依赖与测试命令，再安装准确版本并提交 lockfile。

```json
{
  "name": "ielts-map-pocket",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "build": "node scripts/build-account.mjs"
  },
  "dependencies": { "@supabase/supabase-js": "2.118.0" },
  "devDependencies": { "esbuild": "0.28.2", "supabase": "2.122.0" }
}
```

`.gitignore` 内容：

```gitignore
node_modules/
.env
.env.*
!.env.example
.verification/
.supabase/
```

命令：`npm install --ignore-scripts`。检查锁定版本 esbuild 与 supabase 的安装脚本和二进制来源后，分别执行 `npm rebuild esbuild`、`npm rebuild supabase`，并用各自版本命令确认可执行；不执行不明依赖的安装脚本。

- [ ] 写出以下实际行为测试，并先运行，确认由于模块缺失而失败。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { changedMarks, conservativeStatus, importLegacy } from '../account/core.mjs';

test('两端不同卡片取并集，空记录不清空云端', () => {
  assert.deepEqual(importLegacy({ a: 'known' }, { b: 'weak' }),
    { a: 'known', b: 'weak' });
  assert.deepEqual(importLegacy({}, { b: 'known' }), { b: 'known' });
});
test('没有时间的冲突保留不熟', () => {
  assert.equal(conservativeStatus('known', 'weak'), 'weak');
  assert.equal(conservativeStatus('weak', 'known'), 'weak');
});
test('明确取消标记必须生成 new 操作', () => {
  assert.deepEqual(changedMarks({ a: 'weak' }, {}),
    [{ cardId: 'a', status: 'new' }]);
});
```

- [ ] 实现核心函数，并由词库生成 ID 允许集合；测试中的 a/b 仅为模块测试夹具，不写入生产库。

```js
const rank = Object.freeze({ new: 0, known: 1, weak: 2 });
export function conservativeStatus(a = 'new', b = 'new') {
  if (!Object.hasOwn(rank, a) || !Object.hasOwn(rank, b)) {
    throw new TypeError('Invalid mark status');
  }
  return rank[a] >= rank[b] ? a : b;
}
export function importLegacy(local = {}, cloud = {}) {
  const result = { ...cloud };
  for (const [id, status] of Object.entries(local)) {
    if (status !== 'known' && status !== 'weak') continue;
    const merged = conservativeStatus(status, cloud[id] ?? 'new');
    if (merged !== 'new') result[id] = merged;
  }
  return result;
}
export function changedMarks(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter(id => (before[id] ?? 'new') !== (after[id] ?? 'new'))
    .map(cardId => ({ cardId, status: after[cardId] ?? 'new' }));
}
```

- [ ] 补充无效 ID、原型属性、畸形缓存、重复操作 ID 的测试。用 `Object.create(null)` 或显式校验避免把对象原型当作标记；JSON 解析后仅取白名单字段。
- [ ] 运行 `npm test`，确认通过，再提交：`feat: define versioned pocket progress model`。

## Task 3：私有进度表与事务 RPC

**创建：** CLI 命名的迁移文件、`tests/database-access.sql`。

- [ ] 通过 `npx --no-install supabase --help`、`npx --no-install supabase migration new --help` 确认 CLI 参数，再执行 `npx --no-install supabase migration new pocket_account_progress`，使用它实际生成的文件名。
- [ ] 建立以下表，保留旧表完整：

```sql
create table public.pocket_cards (
  card_id text primary key
);
create table public.pocket_study_marks (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null references public.pocket_cards(card_id),
  status text not null check (status in ('new','known','weak')),
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
create table public.pocket_view_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  card_id text references public.pocket_cards(card_id),
  filter text not null check (filter in ('core','all','weak','new')),
  category text not null,
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now()
);
create table public.pocket_sync_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
```

- [ ] 从 `index.html` 的 `#studyData` 提取并校验 132 个唯一卡片 ID，写为同一迁移中的精确 INSERT 数据；分类允许集合也从同一数据源生成。不要手写或猜测卡片 ID。
- [ ] 对全部 pocket 表开启 RLS。catalog 仅向 authenticated 提供允许的 SELECT；其余三表的 SELECT/INSERT/UPDATE 分别限定 `(select auth.uid()) = user_id`，UPDATE 同时有 USING 与 WITH CHECK。不授予 anon 任何访问；不授予客户端 DELETE/TRUNCATE。
- [ ] 实现 `public.pocket_sync_progress(p_operations jsonb, p_view jsonb default null)`：`SECURITY INVOKER`、固定 `search_path`、显式身份检查；撤销 PUBLIC/anon 的 EXECUTE，仅授权 authenticated。
- [ ] RPC 输入合同：最多 200 个操作、总输入不超过 128 KiB；每个操作仅有 `operationId`、`cardId`、`status`、`baseRevision`。版本必须为非负整数，ID 必须属于 catalog；位置同样校验。
- [ ] 在同一事务中用当前 `auth.uid()` 的 advisory transaction lock 串行化本账号写入。按 `(user_id, operation_id)` 去重；相同 ID 不同请求摘要直接拒绝；相同 ID 相同内容返回已存结果。
- [ ] 对每张卡读取当前版本。版本匹配则应用新状态；版本过期且内容不同则按 `weak > known > new` 合并并返回 `conflict: true`。版本与更新时间由数据库维护，不能接受客户端指定的更新时间。保留 new 行作为取消标记的版本记录。
- [ ] RPC 返回完整当前标记快照、`acknowledgedOperationIds`、冲突卡片 ID 与位置。快照中的每项固定为 `{cardId,status,revision,updatedAt}`；不返回其他用户或认证内部字段。
- [ ] 位置单独比较版本。冲突时返回云端位置，不因位置冲突回滚卡片写入，也不强制前端跳卡。
- [ ] 添加正常写入、重复重试、同卡并发、不同卡并发、明确清除、无效 ID、伪造 owner、匿名访问的验证。用专用临时账号，不依赖现有用户的进度；SQL 验证事务在结束时回滚。
- [ ] 使用 `apply_migration` 将完成并检查过的 DDL 应用到托管项目；不要用 execute_sql 绕开托管迁移记录。执行测试查询并检查安全建议后再提交迁移。

## Task 4：本地缓存、旧数据导入及同步状态机

**创建：** `account/storage.mjs`、`account/sync.mjs`、`tests/storage.test.mjs`、`tests/sync.test.mjs`。

- [ ] 为 storage 模块写测试：保存前先备份原始 v1 字符串；写入失败保留原内容；A/B 分区互不读取；队列刷新后存在；只删除已确认的 operationId。
- [ ] 使用固定键 `pocket:guest-backup:v1` 保存原始备份，账号命名空间为 `pocket:account:v2:<uid>`；缓存结构含 `schemaVersion: 2`、`deviceId`、`marks`、`view`、`outbox`、`legacyImportComplete`。拒绝错误版本，保留不能解析的原始数据供恢复。
- [ ] 同步控制器通过依赖注入接收 `api`、`storage`、`clock` 和页面桥接，不能直接耦合 DOM，便于用两个独立内存存储验证并发。
- [ ] 先写以下队列测试：发送 op1 时又产生 op2；服务器只确认 op1 后队列中必须仍有 op2。重试 op1 不改变其 operationId。
- [ ] 加入账号隔离测试：A 的请求尚未完成时切到 B，A 的响应既不能应用到 B 页面，也不能删 B 队列；为每次账号切换增加 generation 标识并检查响应所属账号。
- [ ] 为单个账号使用单飞同步；新请求到来时记录需要再跑一轮，不能并行提交两份同账号队列。上传前拉取最新状态；当前未确认本地操作叠加在云端快照上，不能因拉取而消失。
- [ ] 退避序列为 2、4、8、16、32、60 秒，失败上限 60 秒；成功重置。online、focus、用户“立即同步”可提前重试；离线与未认证不发请求。
- [ ] 页面前台、登录后每 15 秒触发一次同步；隐藏时停止轮询；恢复前台立即触发。记录并清理所有监听器和 timer。
- [ ] 旧数据导入只上传明确存在的 known/weak；先征求页面中的一次合并选择，持久化导入完成标记，重复执行幂等。旧域名的数据不能凭空读取，保留这个边界。
- [ ] 运行 `npm test`，所有上述竞争与失败场景通过后提交：`feat: add account-scoped offline sync queue`。

## Task 5：账号界面与学习页面桥接

**创建：** `account/auth.mjs`、`account/ui.mjs`、`account/main.mjs`、`account/account.css`、`scripts/build-account.mjs`。
**修改：** `index.html`；不将现有 `offline.html` 转成依赖网络的登录页面。

- [ ] 认证客户端采用已读取的项目 URL 和 modern publishable key。配置只从 `account/config.json` 读取，验证 HTTPS 和 Supabase 项目域名；禁止出现 service_role、secret key 或管理 token。
- [ ] 认证适配器只封装官方 `signUp`、`signInWithPassword`、`resetPasswordForEmail`、`updateUser`、`signOut({scope:'local'})` 与 `onAuthStateChange`；回跳明确指向本站根页面。回调成功后从地址中移除认证参数，防止复制链接泄漏会话。
- [ ] `onAuthStateChange` 回调只排队调度认证状态变化，不在回调中等待另一个 Supabase 调用，避免会话锁重入。
- [ ] 账号界面使用原生 dialog 与独立 label，包含登录/注册/找回密码/设置新密码状态、提交中禁用状态、成功/失败区域、退出本设备、立即同步与一次旧进度合并入口。显示“仅保存在本机／正在同步／已同步／离线，联网后自动同步／需要重新登录”。
- [ ] 输入密码只留在表单内存，完成或退出关闭时清空。注册确认未完成、错误密码、限流和发信失败分别提示；找回密码的成功提示不泄露邮箱是否已注册。
- [ ] 在现有学习 script 内导出只读 `window.pocketStudy.read()` 和 `window.pocketStudy.apply(snapshot, {restoreView})`。read 返回 marks、filter、category、当前稳定 cardId；apply 用现有 makeDeck/renderCard 更新界面并保持有效卡片。
- [ ] `persist()` 完成本地写入后派发 `pocket:progress`；同步程序应用云端状态时使用 applying 标志，不能把应用远端数据再次生成新操作。初次启动不能先把空状态上传覆盖云端。
- [ ] 只在首次载入、尚无本轮交互且云端位置有效时恢复位置。远端标记可以刷新熟悉度计数，但不能打断当前正在看的卡片。
- [ ] 构建脚本将账号入口打包为本地 `assets/account.js`，复制样式，给加载地址附加内容 hash。重复运行构建不得重复注入桥接代码或 script/link。
- [ ] 将独立 `offline.html` 作为构建时静态模板打入下载逻辑；在线页面的“下载离线版”下载这个固定模板，而不再序列化含登录信息的实时 DOM。离线文件本身继续使用当前已有下载逻辑。
- [ ] 用已登录的合成会话验证离线文件不含邮箱、密码、access/refresh token、账号标记或在线账号界面；并实际打开下载文件检查翻卡。
- [ ] 运行 `npm test` 与 `npm run build`，检查 Git diff 没有改动词库内容或丢失字体许可证，然后提交：`feat: add email login and progress sync interface`。

## Task 6：端到端验收与 GitHub Pages 发布

**创建：** `tests/auth-browser.mjs`、`docs/account-sync-verification.md`。
**修改：** `README.md`，去掉“手机电脑不互通”的旧说明，补充登录、旧进度合并和离线边界。

- [ ] 用两个独立浏览器上下文和同一临时账号完成登录；A 标记一张卡，B 在轮询或点击同步后看到相同状态。用另一个账号证实隔离。
- [ ] 完整走通注册、验证回跳、密码登录、找回密码及当前设备退出；不能用伪造 session 的测试代替真实认证验收。临时账号用受控测试邮箱；不触碰现有用户密码。
- [ ] 断开 A 网络、继续标记并重载，再恢复网络，检查补传和重试幂等；制造同卡不同状态与不同卡同时写入，检查结果符合规则。
- [ ] 在账号 A 请求未完成时切换 B，检验没有进度串号。验证默认未登录和直接 REST/RPC 请求都不能读取其他用户。
- [ ] 检查 320/390px 账号界面、132 条词表、核心分类、翻卡、自测、搜索、打印和离线下载。语音实际音色依设备，不能只靠脚本触发就宣称手机声音验证完成。
- [ ] 运行 Supabase 安全与性能建议，修复新引入的问题；对旧业务原有问题单独记录，不在本任务擅自改动。
- [ ] 扫描所有暂存文件、构建产物、离线下载和日志，确认不存在服务器密钥、测试密码、私有 session 或用户邮箱。
- [ ] 将每项实际结果写入验收记录，注明项目引用、迁移名称、部署 commit 与残余验证限制。
- [ ] 推送当前 main，等待 GitHub Pages workflow 成功；校验发布文件与 commit 一致，并在真实线上地址重复双会话核心同步检查。
- [ ] 返回现有网址，说明两台设备登录同一账号与合并旧进度的操作；请用户用中国移动验证新认证服务可达性。若手机请求仍受阻，明确是哪一个域名失败，再调整接入，不宣称同步已经普遍可用。
- [ ] 关闭本任务启动的预览服务和测试浏览器，保留用户现有标签页。

## 计划自检与后续执行选择

本计划覆盖已批准设计中的：保留原站、认证、邮件就绪、旧进度备份与导入、无时间戳冲突、逐卡版本、new 墓碑、幂等、断网、账号切换隔离、位置不跳动、离线文件清洁、权限测试与线上验证。

后续由用户选择“当前对话按顺序执行”或“分工执行”。只有该选择确认后，才开始上述恢复项目、安装依赖、数据库变更与产品代码修改。
