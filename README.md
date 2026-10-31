# HL-Pick

Hyperliquid 永续合约交易员筛选器。像刷短视频一样上下/左右滑动浏览地址，查看周期收益率、最大回撤、夏普、收益风险比、当前杠杆与持仓，并加入观察列表。

部署路径：`/add-pick`（Next.js `basePath`）。

## 功能

- **双向刷卡**：上下滑（抖音式）与左右滑可切换；桌面端支持键盘 `← → ↑ ↓ / PageUp / PageDown / Home / End`，`O` 在新标签页打开 Hyperdash。
- **卡片指标**：ROI、周期盈亏、成交额、最大回撤、夏普、Calmar、当前/净杠杆、多空名义、持仓集中度、当前持仓与持仓时长。
- **筛选**：来源（全部 / 我的精选 / 观察列表）、排序（ROI / 盈亏 / 成交额）、最小净值、最小成交额。
- **观察列表**：服务端 SQLite 持久化，支持备注、导入地址、一键“刷观察列表”。
- **进度记忆**：按筛选/周期记住最后浏览的地址，浏览器本地下次打开自动回到该卡片，不用从头再刷。
- **详情跳转**：卡片“查看详情”直接打开 `https://hyperdash.com/address/<地址>`（站内不再自带详情页）。
- **缓存与限流**：排行榜服务端入库（39MB 文件不下发浏览器），HL 请求统一令牌桶，API 入站限流。
- **后台任务**：排行榜同步、Top 卡片预热、持仓快照。

## 快速开始

```bash
npm install

# 1) 同步 Hyperliquid 排行榜（首次必须）
npm run sync

# 2) 可选：导入你自己的地址列表（一行一个，支持 address,label）
npm run import:seed -- data/seed-addresses.txt

# 3) 开发
npm run dev
# http://localhost:3005/add-pick
```

生产：

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 logs hl-pick-web
```

单机内存较小时，**不要**在 web/worker 运行时直接构建（Next.js 可能被 OOM 杀掉）。用：

```bash
bash deploy/rebuild.sh
```

它会先停 PM2、清 `.next`、构建、再启动，避免和 worker 抢内存。

或者 Docker：

```bash
docker compose up -d --build
# 应用只监听 127.0.0.1:3005，由宿主机 nginx 反代
```

## Nginx

把 `deploy/nginx-add-pick.conf` 里的两个 location 粘到 TLS `server {}` 中，放在 `location /` 之前，然后：

```bash
nginx -t && systemctl reload nginx
```

**不要**在 `proxy_pass` 后面加斜杠，也不要 rewrite 掉 `/add-pick` 前缀。

## 环境变量

见 `.env.example`。关键项：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATA_DIR` | `./data` | SQLite 与缓存目录 |
| `BASE_PATH` / `NEXT_PUBLIC_BASE_PATH` | `/add-pick` | **构建时**生效，改动需重新 build |
| `HL_WEIGHT_CAP_PER_MIN` | `700` | 单个进程的 HL 上游配额；web + worker 合计需 < 1200 |
| `INBOUND_RATE_LIMIT` | `90` | 每个 IP 每分钟请求数 |
| `WARM_TOP` | `200` | worker 预热卡片数 |
| `SNAPSHOT_TOP` | `300` | 每 15 分钟持仓快照的地址数 |
| `AUTO_HOLDING` | `1` | 设为 `0` 时不在预热路径触发逐笔回溯（worker 使用） |

## 数据口径与已知限制

- **周期**：`1D / 7D / 30D / ALL` 对应 Hyperliquid 的 `perpDay / perpWeek / perpMonth / perpAllTime`，只统计永续合约。
- **收益率**：用净值与累计 PnL 反推外部资金流，按子区间收益链式计算 TWR；出入金不会直接抬高收益率。
- **最大回撤**：在 TWR 净值指数上计算峰谷回撤。
- **夏普**：日收益年化（√365）；少于 7 个日收益点时显示“样本不足”。
- **当前杠杆**：`totalNtlPos / accountValue`；历史平均杠杆无法从公开 API 回填，只能从部署后的持仓快照开始积累。
- **排序**：地址顺序由当前排序字段决定（默认 30D ROI 降序），同值时按净值、地址稳定排序；`本地进度` 会记住你上次看到的位置。
- **持仓时长**：Hyperliquid 没有历史持仓接口，按逐笔成交重建。单地址单次最多返回 **2000 笔**成交；高频地址的可用历史可能只有几分钟到几小时，此时会标注“截断/≥”，不会假装完整。
- **HIP-3**：首版只覆盖主永续 DEX，`clearinghouseState` 默认不聚合 builder dex。
- **地址池**：排行榜快照（约 4.7 万行）∪ 你的种子列表 ∪ 观察列表。种子列表里不在排行榜上的地址会显示“待补充”，进入卡片后再按需拉取实时指标。
- **合规**：仅使用 Hyperliquid 公开只读 API，不包含下单/跟单/私钥。数据仅供参考，不构成投资建议。

## 目录

```
src/app/                页面与 Route Handlers（/api/deck、/api/trader/[address]、/api/watchlist、/api/status）
src/components/deck/    刷卡容器、卡片、筛选面板
src/components/watchlist/ 观察列表页面
src/lib/hl/client.ts    HL info API 客户端（令牌桶、权重记账、重试）
src/lib/metrics.ts      账户级指标（纯函数）
src/lib/positions.ts    逐笔 → 仓位 episode / 持仓时长（纯函数）
src/lib/deck.ts         地址池查询与观察列表
src/worker/index.ts     后台同步与预热
scripts/                排行榜同步、种子导入、构建后处理
```

## 常用命令

```bash
npm run dev
npm run build
npm run start            # next start，端口 3005
npm run worker           # 独立 worker（也可以直接 npm run sync 手动同步）
npm run sync             # 手动同步排行榜
npm run import:seed -- data/seed-addresses.txt
npm test                 # 指标/仓位重建单测
```

## 运维

- 状态：`GET /add-pick/api/status`，返回排行榜同步时间、上游配额使用、缓存与地址数。
- SQLite 使用 WAL；web 与 worker 共用同一个 `DATA_DIR`。
- 排行榜下载使用 `If-None-Match` 条件请求，未更新时不会重复拉 39MB。
- 若日志出现 429，降低 `HL_WEIGHT_CAP_PER_MIN` 或提高 `SYNC_INTERVAL`。
