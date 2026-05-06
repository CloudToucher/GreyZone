# 灰区：撤离 — 架构实施报告

## 实施状态：全部完成 (P0-P3)

---

## 已解决问题

### 1. result.md 为空 → ✅ 已解决
- **根因**: Windows inherit stdio 导致 stdout 不可捕获
- **方案**: 文件即协议。opencode 必须用 Write 工具写入 result.md，Engine 从磁盘读取
- **关键文件**: `webui/server/opencode.ts` 中 `readResultFromDisk()` 函数

### 2. 无起点 → ✅ 已解决
- **方案**: "进入灰区"按钮 (`POST /api/game/enter`)
- **流程**: 点击 → 启动 DM Session → 产出欢迎场景 → 标记推送 → 前端显示
- **关键文件**: `webui/src/rebuild/PlayerWorkspace.vue`

### 3. 每轮新进程 → ✅ 已解决
- **方案**: 长生命期 DM Session，一个 opencode 进程处理多轮
- **通信**: trigger 文件驱动，DM Session 用 bash wait 检测 `table/dm_trigger`
- **关键文件**: `webui/server/opencode.ts` 中 `startDmSession()`, `writeDmTrigger()`, `pollDmResult()`

### 4. 角色/玩家视角混淆 → ✅ 已解决
- **方案**: 三条独立通道
  - DM Channel: 叙事裁决 (长生命期 Session)
  - Assistant Channel: 规则问答 (一问一答独立进程)
  - Forge Channel: 角色创建 (一次性独立进程)
- **关键文件**: `webui/server/grayZone.ts` 中 `createAssistantPrompt()`

### 5. 回合完成判定 → ✅ 已解决
- **方案**: result.md 末尾追加机器可读标记
  - DM 回合: `<!-- ROUND_DONE {"round_id":"...","status":"ok"} -->`
  - 创角: `<!-- FORGE_DONE {"name":"...","status":"ok"} -->`
  - 助手: `<!-- ASSISTANT_DONE {"status":"ok"} -->`
- **Engine 轮询**: 每 2 秒检查 result.md 最后几行

### 6. packet.md 膨胀 → ✅ 已解决
- **方案**: 精简为"意图 + 文件引用"，不再内联角色摘要和共享看板
- **效果**: packet 体积减小约 70%

### 7. 会话生命周期 → ✅ 已解决
- **心跳**: DM Session 每轮空闲时写 `table/dm_heartbeat`，Engine 每 30s 检查
- **恢复**: 会话切换前写 `table/session_save.md`，新会话读取恢复
- **自动重启**: heartbeat 过期 (>300s) → Engine 杀掉旧会话并重启

---

## 架构全景

```
WebUI (Vue 3)
  ├── [进入灰区] 按钮 → POST /api/game/enter → 启动 DM Session
  ├── [创建角色] 按钮 → POST /api/round/run (forge) → Forge Session
  ├── [规则助手] 面板 → POST /api/assistant/ask → Assistant Session
  ├── [提交行动] 按钮 → 写入意图 → 写入 dm_trigger → DM Session 处理
  └── SSE 事件流 ← Engine 推送 (snapshot / round / snapshot-refresh)

Round Engine (Node.js)
  ├── 管理 room/seats/control/intents
  ├── 创建精简 packet.md → 写入 dm_trigger
  ├── pollDmResult() 轮询 result.md 末尾标记
  ├── startDmHeartbeat() 每 30s 检查心跳
  └── 检测标记 → 推送 resultContent 到前端

DM Session (opencode 进程)
  ├── 初始化 (仅一次): 读取规则/角色/局面 → 写欢迎场景
  ├── bash wait table/dm_trigger (最多 300s 超时)
  ├── 检测 trigger → 读 packet → 处理 → 写 result.md + 标记
  └── 循环直到轮次上限 (20-25 轮) → 写 session_save.md → 退出

Assistant Session (opencode 进程，一问一答)
  └── 读取 rules/ → 回答 → 写 result.md + ASSISTANT_DONE 标记

Forge Session (opencode 进程，一次性)
  └── 读取模板 → 生成角色卡 → 写 FORGE_DONE 标记
```

---

## 文件变更清单

| 文件 | 变更 | 说明 |
|------|------|------|
| `webui/server/grayZone.ts` | +282 行 | 新增 createWelcomePrompt, createDmSessionPrompt, createAssistantPrompt；更新 createRoundPrompt, createForgePrompt |
| `webui/server/opencode.ts` | +342 行 | readResultFromDisk, runWelcomeRound, runAssistantQuery, startDmSession, writeDmTrigger, pollDmResult, startDmHeartbeat；更新 startProcess |
| `webui/server/runtime.ts` | +10 行 | VisibleRoundState 增加 resultContent/resultMarker |
| `webui/server/core.ts` | ~92 行重构 | createAiRoundPacket 精简为文件引用模式 |
| `webui/server/files.ts` | +154 行 | 新增 /api/game/enter, /api/assistant/ask；意图提交接入 DM Session trigger |
| `webui/src/App.vue` | +16 行 | enterGreyZone 处理器 |
| `webui/src/lib/api.ts` | +14 行 | enterGreyZone, askAssistant API 函数；VisibleRoundState 接口更新 |
| `webui/src/rebuild/PlayerWorkspace.vue` | +110 行 | "进入灰区"按钮、完整 DM 回复显示、规则助手面板 |

---

## 新 API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/game/enter` | POST | 启动 DM Session，生成欢迎场景 |
| `/api/assistant/ask` | POST | 提交规则问题，返回规则解答 |
| `/api/round/run` (forge) | POST | 创建角色（已有，已更新 prompt） |
| `/api/intents/self` (submitted) | PUT | 提交行动 → 写入 dm_trigger 或启动 per-round 进程 |

---

## 测试指南

1. **进入灰区**: 加入席位 → 创建角色 → 点击"进入灰区" → 等待欢迎场景出现
2. **提交行动**: 在意图区写行动 → 点击"提交给 AI DM" → 等待 DM 回复在左侧显示
3. **规则问答**: 在规则助手输入问题 → Ctrl+Enter → 等待回复
4. **连续回合**: 提交多轮行动 → DM Session 持续处理不重置
5. **会话恢复**: 如果 DM Session 结束 → Engine 自动重启新会话 → 读 session_save.md 恢复
