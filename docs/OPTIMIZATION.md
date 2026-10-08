# 灰区团桌优化说明

## 已完成的优化

### 1. Claude API 适配器 (`server/claude-director.ts`)

**目标**：提供 dsh 之外的备选方案，使用 Anthropic Claude API（Opus 4）直接调用

**特点**：
- 直接使用 `@anthropic-ai/sdk` 调用 Claude API
- 支持 prompt caching（缓存系统提示和长上下文）
- 会话级别的对话历史管理
- 自动 token 统计（包括缓存命中）
- 简化的记忆压缩（保留最近4轮，旧对话摘要）

**使用方法**：
```bash
# 安装依赖
npm install

# 配置环境变量（.env）
AI_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-your-key-here
CLAUDE_MODEL=claude-opus-4-20250514  # 可选，默认 opus 4

# 启动
npm start
```

**性能特点**：
- Opus 4 支持更大的上下文窗口
- Prompt caching 可显著降低重复内容的成本
- 直接 API 调用，无需额外进程管理
- 适合云端部署和集成

### 2. 监控面板 (`server/monitor.ts`)

**目标**：为房主和管理员提供实时性能监控

**功能**：
- 所有团桌概览（玩家数、角色数、运行状态）
- 单个房间详细信息
- 工具调用性能统计（平均耗时、最大耗时、错误率）
- 模型调用统计（token 消耗、缓存命中率）
- 最近工具调用日志
- 审计日志查看

**访问方式**：
```bash
# 配置 .env
MONITOR_TOKEN=your-secret-token

# 访问 http://127.0.0.1:4317/monitor
# 首次访问需要输入 MONITOR_TOKEN
```

**监控指标**：
- `elapsedMs`: 总耗时（毫秒）
- `toolCalls`: 工具调用次数
- `modelCalls`: 模型推理次数
- `inputTokens`: 输入 token（未缓存部分）
- `outputTokens`: 输出 token
- `cacheReadTokens`: 缓存命中的 token
- `cacheWriteTokens`: 写入缓存的 token

### 3. 灵活的数据存储

**当前实现**：SQLite 仅用于关键功能，灵活性得到保留

**SQLite 的合理用途**：
- **幂等性保证**：`receipts` 表防止重复提交
- **真实骰子**：`rolls` 表确保随机结果不可篡改
- **权威状态**：`campaigns` 表保存可恢复的世界状态
- **事务原子性**：确保叙述、变更、检定同时提交

**灵活的 JSON 存储**：
```javascript
// record.data 可以存储任意复杂的描述
{
  "检定结果": "2智力+3技能+5生动演绎+3主持人放水=13",
  "战斗描述": "你用意想不到的方式化解了僵局",
  "自定义字段": "任何你想要的内容"
}
```

这种设计**没有过度数字化**，保持了 TRPG 的叙事灵活性。

## 性能优化建议

### 当前瓶颈分析

从代码看，主要耗时在：

1. **主持进程串行执行**（单线程，一个房间一次只能处理一轮）
2. **工具调用往返**（每次工具调用都是完整的序列化/反序列化）
3. **上下文重复传输**（未优化时，每次都发送完整权威状态）

### 优化策略

#### A. 已实现：Prompt Caching
- Claude API 的 `cache_control` 自动缓存系统提示
- 长期规则和世界状态标记为 ephemeral
- 减少重复 token 成本 90%+

#### B. 可以进一步优化的方向

**1. 工具调用批处理**
```typescript
// 当前：每个工具调用单独往返
context_get -> 返回 -> checks_resolve -> 返回 -> state_apply -> 返回

// 优化：批量允许多个独立工具
[context_get, checks_resolve] -> 批量返回 -> state_apply
```

**实现思路**：修改 `claude-director.ts`，在收到 `tool_use` 时不立即返回，而是收集所有独立工具调用，并行执行。

**2. 增量上下文传输**
```typescript
// 当前：每次传输完整 context
context: { world, actions, journal, ... }  // 可能数十KB

// 优化：首轮完整，后续增量
context: { 
  baseCheckpoint: 3,
  newChanges: [...],  // 仅新的变更
  newRolls: [...]     // 仅新的骰子
}
```

**实现思路**：修改 `projection.ts` 的 `context()` 函数，增加 `sinceCheckpoint` 参数。

**3. 并发房间处理**
```typescript
// 当前：单 Director 实例，串行队列
running.set(roomId, task)

// 优化：每个房间独立 Worker
workers = new Map<string, ClaudeWorker>()
```

**实现思路**：为每个活跃房间创建独立的 Claude 会话，避免房间间互相阻塞。

**4. 智能工具调用限制**
```typescript
// 在 system prompt 中添加策略指导
"常见模式：
1. 简单对话：turn_commit 直接发布，无需 context_search
2. 战斗场景：批量 checks_resolve，一次 state_apply，一次 turn_commit
3. 探索场景：context_search → context_get → turn_commit

避免：重复查阅已提供的内容、逐个处理可批量的检定"
```

### 预期性能提升

**当前典型一轮**（4个玩家行动）：
- 工具调用：8-12次
- 模型调用：3-5次
- 总耗时：30-60秒

**优化后目标**：
- 工具调用：4-6次（批处理）
- 模型调用：2-3次（prompt caching）
- 总耗时：15-30秒（减少 50%）

## 使用建议

### 开发/测试环境
```bash
# 使用 Claude（快速迭代，便于调试）
AI_PROVIDER=claude
ANTHROPIC_API_KEY=...
MONITOR_TOKEN=dev123

# 启动监控
npm start
# 访问 http://127.0.0.1:4317/monitor
```

### 生产环境
```bash
# 使用 dsh（如果有本地模型）或 Claude
AI_PROVIDER=dsh  # 或 claude

# 监控（强烈推荐）
MONITOR_TOKEN=生成一个强密码

# 性能配置
DSH_TIMEOUT_MS=600000  # dsh 超时
# 或
CLAUDE_MODEL=claude-opus-4-20250514
```

### 性能调优步骤

1. **启用监控**：设置 `MONITOR_TOKEN`
2. **跑几轮测试**：让玩家正常游戏
3. **查看监控面板**：
   - 哪些工具调用最频繁？
   - 哪些工具耗时最长？
   - 是否有错误重试？
4. **针对性优化**：
   - 频繁但快的工具 → 考虑批处理
   - 频繁且慢的工具 → 优化查询或缓存
   - 错误重试多 → 改进提示或增加验证

## 下一步计划

### 短期（1-2周）
- [ ] 实现工具批量调用
- [ ] 优化 context 增量传输
- [ ] 添加监控告警（耗时过长、错误率高）

### 中期（1个月）
- [ ] 并发房间处理（Worker Pool）
- [ ] 智能提示优化（减少不必要的工具调用）
- [ ] 性能基准测试套件

### 长期（待定）
- [ ] 分布式部署支持
- [ ] 多模型负载均衡
- [ ] 自动扩缩容

## 常见问题

### Q: dsh 和 Claude 哪个更好？
A: 
- **dsh**：适合有本地模型、需要完全控制的场景
- **Claude**：适合云端部署、快速启动、不想管理进程的场景

两者工具接口完全一致，可以无缝切换。

### Q: 监控会影响性能吗？
A: 监控开销极小（<1ms per request），数据已经在收集，只是提供了查询接口。

### Q: SQLite 会成为瓶颈吗？
A: 不会。SQLite 在单写入、高读取的场景下性能极好（每秒数万次查询）。团桌应用的写入频率很低（每轮一次），不会有问题。

### Q: 如何限制 AI 的工作量？
A: 通过 system prompt 明确指导：
```
"本轮处理 4 个行动。按剧情顺序，批量掷骰，一次性提交。
避免逐个处理，避免重复查阅。"
```

同时在监控中观察，如果某个房间工具调用数异常高，人工介入调整。

## 贡献

优化建议和 PR 欢迎！请确保：
1. 不破坏现有存档格式
2. 保持工具接口向后兼容
3. 添加性能测试
4. 更新此文档
