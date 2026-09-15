# 电力配网抢修闭环系统（grid-repair）

面向供电所的配网故障报修、抢修派工、备件领用与复电闭环平台。
登记故障后自动合并**同线路同类型**的未闭环报修并按**最高等级**生成工单；派工严格校验
**技能匹配 / 值班中 / 无在途任务**；班组复电后按**等级 + 等待时长**自动补派排队工单；
备件领用与库存、工单占用**同事务联动**；调度员、班组长、仓管员、审计员四类角色各司其职，
关键变更全部留痕可溯。

## 快速启动

### 本地运行（推荐，一条命令）

```bash
cd backend && npm install && npm start
```

- 后端 + 前端（已构建的静态资源由后端托管）：<http://localhost:21104>
- 健康检查：<http://localhost:21104/health>
- 首次启动自动建库并写入种子数据（`backend/data/grid-repair.sqlite`）

前端改动后重新构建即可，无需重启后端：

```bash
cd frontend && npm install && npm run build
```

前端联调开发（Vite 热更新，代理 `/api` 到 21104）：

```bash
cd frontend && npm run dev   # http://localhost:20104
```

### Docker Compose

```bash
cp .env.example .env && docker compose up -d --build
```

前端 <http://localhost:20104>（nginx 反向代理 `/api` 到后端），后端数据持久化在 `backend_data` 卷。

## 演示账号（密码均为 `123456`）

| 账号 | 角色 | 能做什么 |
|---|---|---|
| `dispatcher01` | 调度员 | 登记报修、派工、改派/撤回、班组值班维护、资产健康调整 |
| `leader01`~`leader04` | 班组长 | 推进本班组工单（到场→处理→复电→关闭）、申请/退回/核销备件 |
| `keeper01` | 仓管员 | 备件审批出库/驳回、采购入库、查看库存流水 |
| `auditor01` | 审计员 | 只读查询审计日志与库存流水 |

越权操作由后端 RBAC 中间件统一拦截（403 `FORBIDDEN`），前端按钮同步显隐。

## 业务闭环规则

1. **登记合并**：`POST /api/faults` 在同一事务内查找同馈线、同故障类型且**仍可吸收**
   （待派工/已派工/已到场/处理中）的工单——存在则报修合并入该工单并按最高等级提升优先级；
   否则生成新的待派工工单。**已复电、已关闭的工单不再吸收新报修**，新报修生成独立待派工单，
   原工单的报修归属与处理历史保持不变。
2. **派工**：仅允许派给技能匹配、值班中且无在途任务（ASSIGNED/ARRIVED/REPAIRING）的班组，
   违反分别返回 `CREW_SKILL_MISMATCH` / `CREW_OFF_DUTY` / `CREW_BUSY`。
3. **补派**：班组长「复电」释放班组后，系统在同一事务内按等级降序、等待时长降序
   为全部空闲值班班组各补派一张匹配工单，绝不重复占用同一班组。
4. **状态机**：`WAIT_DISPATCH → ASSIGNED → ARRIVED → REPAIRING → RESTORED → CLOSED`，
   越级推进返回 `TICKET_BAD_STATE`；关闭时级联闭环关联报修单。
5. **备件**：申请即校验可用库存（超量 `STOCK_INSUFFICIENT`）；审批出库在事务内二次校验并扣减；
   驳回不占库存；退回回补库存；核销不回补；**改派/撤回时，待审批申请作废、已审批备件回库、
   目标班组校验与回滚在同一事务内完成**，每条释放写入含原申请人、数量、前后状态、关联工单的
   可追溯事件，且已释放申请不会被重复释放、重复记录；存在未完结领用的工单禁止关闭。
   每次库存变动写入 `stock_logs` 流水。
6. **可追溯**：登记、合并、派工、补派、推进、改派、审批、退回、核销、入库等均写入
   `audit_logs`（操作人、角色、动作、对象、详情、时间），审计员可按对象检索。
7. **一致性**：所有多步写入包裹在 SQLite 事务中，提交后原子落盘（临时文件 + rename），
   异常整体回滚；刷新或服务重启后状态与故障前一致（有自动化测试覆盖）。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite + Element Plus + Pinia + Vue Router |
| 后端 | Node.js 20 + Express |
| 数据库 | SQLite（sql.js WASM，事务 + 原子落盘持久化） |
| 部署 | Docker Compose（后端托管前端构建产物 / nginx 反代两种形态） |

## 目录结构

```text
backend/
  src/
    main.js            # 入口：初始化 DB、种子、Express、托管前端 dist
    db.js              # sql.js 加载/原子落盘/事务包装
    schema.sql         # 建表 DDL（users/sessions/crews/grid_assets/repair_tickets/
                       #   fault_reports/spare_parts/part_usages/stock_logs/audit_logs）
    constants.js       # 共享枚举、错误码、审计日志模板
    errors.js          # ApiError（错误码 → HTTP 状态）
    seed.js            # 种子数据（npm run seed 可重置）
    middleware/        # auth(RBAC) / rateLimit / errorHandler
    services/          # fault/ticket/crew/part/asset/dashboard/audit/auth 领域服务
    routes/index.js    # REST 路由，挂 /api
  test/e2e.js          # 64 项端到端测试（npm test）
frontend/
  src/
    api.js             # fetch 封装：令牌、统一错误、401 登出
    constants.js       # 与后端共享的枚举与文案
    router.js          # 路由 + 登录/角色守卫
    stores/auth.js     # Pinia 会话（localStorage 持久化）
    components/        # StatusBadge / PriorityTag / StatCard / CrewCard / TimelineList / EmptyState
    pages/             # 登录 / 态势 / 报修 / 工单 / 备件 / 资产 / 审计
```

## API 一览（统一前缀 `/api`，错误格式 `{ error: { code, message } }`）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | `/auth/login` `/auth/logout` | 公开 | 登录/登出（Bearer Token） |
| GET | `/dashboard` | 登录 | 态势总览（待派工/在途/平均复电时长/班组） |
| GET/POST | `/faults` | 登录 / 调度员 | 报修列表 / 登记（自动合并） |
| GET | `/tickets`、`/tickets/:id` | 登录 | 工单列表 / 详情（报修+备件+轨迹） |
| POST | `/tickets/:id/dispatch` | 调度员 | 派工（技能/值班/在途校验） |
| POST | `/tickets/:id/reassign` | 调度员 | 改派或撤回（同步释放备件占用） |
| POST | `/tickets/:id/advance` | 班组长 | 推进 arrive/start_repair/restore/close |
| GET | `/crews`、`/crews/available` | 登录 | 班组列表 / 按故障类型的可派性 |
| PATCH | `/crews/:id/duty` | 调度员 | 值班切换（在途不可下班） |
| GET | `/assets`、`/assets/:id/reports` | 登录 | 资产台账 / 故障历史 |
| PATCH | `/assets/:id/health` | 调度员 | 健康状态调整 |
| GET | `/parts`、`/usages`、`/stock-logs` | 登录 / 仓管+审计 | 库存 / 领用记录 / 流水 |
| POST | `/tickets/:id/parts` | 班组长 | 备件申请（超量拦截） |
| POST | `/usages/:id/approve` `/reject` | 仓管员 | 审批出库 / 驳回 |
| POST | `/usages/:id/return` `/consume` | 班组长 | 退回入库 / 核销消耗 |
| POST | `/parts/:id/restock` | 仓管员 | 采购入库 |
| GET | `/audit-logs` | 审计员 | 审计日志（分页、按对象过滤） |

## 共享枚举位置

| 枚举 | 后端 | 前端 |
|---|---|---|
| `FaultType`（OUTAGE/VOLTAGE_LOW/TRIP/EQUIPMENT_DAMAGE/SAFETY_RISK） | `backend/src/constants.js`（校验、合并维度、日志模板） | `frontend/src/constants.js`（表单、筛选、CrewCard 技能标签） |
| `TicketStatus`（WAIT_DISPATCH→…→CLOSED） | `backend/src/constants.js` + `schema.sql` CHECK 约束 + `services/ticketService.js` 状态机 | `frontend/src/constants.js` + `components/StatusBadge.vue` + 工单页筛选 |
| `AssetHealthStatus`（NORMAL/WATCH/DEGRADED/DANGEROUS） | `backend/src/constants.js` + `services/assetService.js` | `frontend/src/constants.js` + `components/StatusBadge.vue` + 资产页下拉 |
| `Severity`（MINOR/MAJOR/CRITICAL，合并取最高） | `backend/src/constants.js`（SeverityRank） | `frontend/src/constants.js` + `components/PriorityTag.vue` |
| `UsageStatus`（REQUESTED/APPROVED/REJECTED/RETURNED/CONSUMED/RELEASED） | `backend/src/constants.js` + `services/partService.js` | `frontend/src/constants.js` + `components/StatusBadge.vue` |

## 测试

```bash
cd backend
npm test          # 80 项端到端测试：独立端口 + 临时库，覆盖全闭环与异常分支
```

覆盖：认证与四角色 RBAC、登记合并与等级提升、已复电/已闭环工单不吸收新报修、
派工三类校验、状态机越级拦截、超量领用拦截、审批/驳回/退回/核销的库存联动、
改派的同事务释放（待审批作废 + 已审批回库）、改派失败回滚、释放事件逐条可追溯、
重复改派幂等、复电补派排序与不重复占用、关闭级联、审计留痕、重启后状态一致。

前端另有 jsdom 冒烟测试（挂载真实构建产物驱动登录→态势→工单→备件流程），见
`frontend/vite.test.config.js` 与测试脚本说明。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `21104` | 后端监听端口 |
| `GRID_REPAIR_DB_FILE` | `backend/data/grid-repair.sqlite` | SQLite 数据文件路径 |
| `FRONTEND_PORT` / `BACKEND_PORT` | `20104` / `21104` | Compose 端口映射 |
