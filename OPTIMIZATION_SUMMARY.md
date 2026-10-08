# 优化总结

## ✅ 已完成

### 1. Claude API 适配 (`server/claude-director.ts`)
- 支持直接使用 Anthropic Claude API (Opus 4)
- 实现 Prompt Caching 优化成本
- 会话级对话历史管理
- 完整的 token 统计和性能指标

**切换方式**:
```bash
# .env 文件中设置
AI_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-your-key
CLAUDE_MODEL=claude-opus-4-20250514  # 可选
```

### 2. 监控面板 (`server/monitor.ts`)
- 实时团桌状态监控
- 工具调用性能分析
- Token 消耗统计
- 错误追踪

**访问方式**:
```bash
# .env 中配置
MONITOR_TOKEN=your-secret-token

# 访问
http://127.0.0.1:4317/monitor
```

### 3. 性能指标收集
所有性能数据已自动记录到数据库：
- 每次工具调用的耗时、输入输出大小
- 每轮裁决的 token 消耗、缓存命中率
- 模型调用次数和总耗时

## 🎯 关于数据库使用

**SQLite 的使用非常合理**：
- 仅用于幂等性、骰子持久化、事务原子性
- `record.data` 是灵活的 JSON，可以存任意文本描述
- 没有过度结构化，保持了 TRPG 的叙事灵活性

例如可以这样存：
```json
{
  "检定过程": "2智力+3技能+5生动演绎+3主持人放水=13",
  "战斗描述": "你用意想不到的方式化解了僵局"
}
```

## 🚀 性能优化方向

### 当前可以优化的点

1. **工具调用批处理** - 并行执行独立工具
2. **增量上下文传输** - 只传递新变更而非完整状态
3. **并发房间处理** - 每个房间独立 Worker
4. **智能提示优化** - 减少不必要的工具调用

详见 `docs/OPTIMIZATION.md`

## 📝 使用说明

### 快速开始
```bash
# 1. 安装依赖
npm install

# 2. 配置 .env（复制 .env.example）
AI_PROVIDER=claude  # 或 dsh
ANTHROPIC_API_KEY=sk-ant-...
MONITOR_TOKEN=dev123

# 3. 启动
npm start

# 4. 查看监控
open http://127.0.0.1:4317/monitor
```

### 测试 Claude 适配器
```bash
# 需要先设置 ANTHROPIC_API_KEY
npm run test:claude
```

### 进程控制

监控页面显示所有活动房间的状态，但当前没有从 UI 暂停/恢复的控制。

**建议添加**（如果需要）：
- 在监控页面添加"暂停裁决"按钮
- 调用 `POST /api/rooms/:id/stop` 接口
- 房主在游戏内已有此功能

## 🔧 工具限制和智能体工作量控制

### 当前限制
- 单个工具调用输入 ≤ 12KB (大部分场景足够)
- 批次行动数 ≤ 6 个角色 × 4 行动
- 工具调用计数记录在 metrics 中

### 控制工作量的方法

1. **System Prompt 指导**（已在代码中）:
```
"处理本批冻结行动，按情境决定顺序、检定和实际后果。
读到骰子后继续主持。已提交的部分不要重复。
通过 turn_commit 发布，或在真正的新选择处 turn_ask。"
```

2. **监控告警**（可添加）:
在 `monitor.ts` 中添加阈值检查：
```typescript
if (run.metrics.toolCalls > 20) {
  alert('⚠️ 工具调用过多，可能需要人工介入');
}
```

3. **超时控制**（已实现）:
```typescript
// server/app.ts
const timeout = Number(process.env.DSH_TIMEOUT_MS ?? 600000);
// 超时会标记为 failed，保留进度
```

## 📊 并发能力

### 当前架构
- 每个房间一个队列，串行处理
- 不同房间可以并发（但共享同一 Director）
- 单个裁决运行时，该房间其他请求排队

### 提升并发的方案（未实现）

**方案 A: Worker Pool**
```typescript
class WorkerPool {
  workers = new Map<string, ClaudeDirector>();
  
  async getWorker(roomId: string) {
    if (!this.workers.has(roomId)) {
      this.workers.set(roomId, new ClaudeDirector(...));
    }
    return this.workers.get(roomId);
  }
}
```

**方案 B: 子智能体并发**
```typescript
// 将一批行动拆分给多个子智能体并行处理
const results = await Promise.all(
  actions.map(action => 
    subAgent.process(action)
  )
);
// 主智能体汇总结果
```

这需要更复杂的协调逻辑（冲突检测、资源锁定）。

## 🎮 相近任务合并

工具设计已经支持批量操作：

```typescript
// checks_resolve: 最多 16 个检定一次调用
checks: [
  { id: 'check1', actorId: 'pc1', ... },
  { id: 'check2', actorId: 'pc2', ... },
]

// state_apply: 最多 80 个变更一次调用
changes: [
  { op: 'patch', id: 'pc1', changes: {...} },
  { op: 'transfer', itemId: 'item1', ... },
]

// turn_commit: 批量提交叙述和变更
passages: [...],  // 最多 16 段
changes: [...],   // 最多 80 个
decisions: [...], // 所有行动的裁决
```

智能体可以（也应该）批量使用这些工具。

## 下一步建议

1. **运行测试**: `npm run test:claude` 验证 Claude 适配器
2. **启用监控**: 设置 `MONITOR_TOKEN`，观察几轮游戏
3. **分析瓶颈**: 在监控面板查看哪些工具最耗时
4. **针对性优化**: 根据实际数据决定优化方向

有问题随时问！
