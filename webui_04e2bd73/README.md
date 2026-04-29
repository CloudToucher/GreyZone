# 灰区工作台 (webui)

可视化 + 可交互地玩《灰区：撤离》。Vue 3 / Vite / Tailwind / opencode CLI 集成。

- **顶部 Tab**：DM 视图 ↔ 角色视图
- **角色视图（玩家）**：
  - 首页 = MISSION BRIEFING 主控台（活跃角色 HP/SP/AP 预览 + 快速通道 + 提示）
  - 上半屏 = **PLAYGROUND 编辑器**（textarea + 快速插入片段）+ **DM 控制台**（opencode 实时输出）
  - 下半屏 = 文档浏览（Markdown 渲染）
  - **提交本轮** = 保存 playground.md → 调起 opencode → 流式回显
- **DM 视图（玩家的 DM）**：DM 工作台 + 控制台 + 文档浏览
- 浏览角色卡时（顶部带 YAML frontmatter）会显示游戏 HUD 状态条

## 启动

```bash
cd webui
npm install        # 首次
npm run dev
```

打开 http://127.0.0.1:5173/

## 角色卡 frontmatter 约定

让 HUD 状态条显示 HP/SP/AP/属性：

```markdown
---
name: 铁鼠
level: 3
hp: 80/80
sp: 50/50
ap: 5
attributes:
  STR: 6
  AGI: 8
  CON: 7
  PER: 6
  INT: 5
  WIL: 6
  RES: 4
---

# 角色卡 · 铁鼠
…
```

## 玩 1 个回合的流程

1. **角色视图** → 上半屏左侧 PLAYGROUND，写本轮你想做什么（或点快速片段）
2. 选择活跃角色（下拉框）
3. 点 **提交本轮 →**
4. 后端：保存 `playground.md` → spawn `opencode run -c <prompt>` → 流式输出到右侧 DM 控制台
5. opencode 完成后，前端自动重新读取目录树 + 当前文件（DM 可能改了角色卡 / 写了日志 / 清了 playground）

提示词 = **`dm_guide/快速开始_DM提示词.md`** + 当前角色卡 + `playground.md` + `tools/dice_pool.md` 顶部 60 行 + 你的本轮行动文本。

## 可见性 + 写权限矩阵

| 路径 | DM 看 | DM 写 | 玩家 看 | 玩家 写 |
|---|---|---|---|---|
| `README.md` `开始游戏.md` `playground.md` | ✅ | ✅ | ✅ | playground.md ✅ 其余 ❌ |
| `rules/**` | ✅ | ✅ | ✅ | ❌ |
| `characters/templates/**` | ✅ | ✅ | ✅ | ❌ |
| `characters/active/**` | ✅ | ✅ | ✅ | ✅ |
| `assets/items/**` | ✅ | ✅ | ✅ | ❌ |
| `logs/**` | ✅ | ✅ | ✅ | ✅ |
| `dm_guide/**` `scenes/**` `story/**` `assets/enemies/**` `assets/npcs/**` `tools/**` | ✅ | ✅ | ❌ | ❌ |

强校验在 `webui/server/files.ts`：白名单 + `..` 拒绝 + .md 仅写。

## API

- `GET  /api/health` — sanity
- `GET  /api/tree?panel=dm|player` — 过滤后的目录树
- `GET  /api/file?panel=...&path=<rel>` — `{ path, size, mtime, frontmatter, content }`
- `PUT  /api/file?panel=...&path=<rel>` — body `{ content }`，仅 .md，按面板写白名单
- `POST /api/round` — body `{ action, character?, prompt? }`；返回 `{ roundId }`
- `GET  /api/round/stream?id=<roundId>` — Server-Sent Events 流式回放 + 实时输出

事件类型：`meta` `start` `stdout` `stderr` `error` `end`

## 目录

```
webui/
├── package.json / vite.config.ts / tailwind.config.ts / tsconfig.json
├── server/
│   ├── files.ts            # GET tree/file, PUT file, POST round, SSE stream
│   └── opencode.ts         # 子进程 + 提示词组装 + SSE 广播
├── index.html
└── src/
    ├── main.ts  App.vue
    ├── styles/tailwind.css  styles/theme.css
    ├── stores/
    │   ├── workspace.ts    # panel/tree/current
    │   └── round.ts        # roundId/status/events/output
    ├── lib/
    │   ├── api.ts          # fetch + SSE
    │   ├── md.ts           # markdown-it + hljs + TOC + table-wrap
    │   └── charsheet.ts    # frontmatter -> HP/SP/AP/属性
    ├── views/
    │   ├── DMView.vue      # DM 工作台 + 控制台 + 文档
    │   ├── PlayerView.vue  # 上半 playground+console / 下半 hub|文档
    │   └── PlayerHub.vue   # 游戏化主控台
    └── components/
        ├── TopBar.vue
        ├── FileTree.vue
        ├── MarkdownView.vue
        ├── StatusBar.vue
        ├── PlaygroundEditor.vue
        └── RoundConsole.vue
```

## 路线图

- ✅ **v0** 阅读 + DM/角色分屏 + frontmatter HUD
- ✅ **v1** 写文件 API + Playground 编辑器
- ✅ **v2** opencode 集成（持久会话 + SSE + 自动文件刷新）
- ⏭ **v3** 多角色身份过滤；骰池剩余可视化；全文搜索
- ⏭ **v4** Tauri 打包桌面 exe；移动端响应式
