# dsh 原生主持运行时

本项目实测 `@deepseek-ai/dsh 0.1.1-rc.2` 的已安装实现。`server/dsh.ts` 查找 `lib/bin.js` 及同安装目录的 `@deepseek-ai` 包；`DSH_BIN` 可以显式指定。模型及 provider 继承用户已有 dsh 配置，网页不读取或展示 API 密钥。

每桌生成一个 headless GM profile 补丁，加载：

- `runtime/runner.mjs`：Cordis 轻量插件，通过 JSONL 接收 run、compact、cancel；调用 `ctx.agents.create/resume`、`agent.followup/cancel/whenIdle`、`sessions.flush`。
- `@deepseek-ai/dsh-mcp-client`：dsh 原生工具接入，连接本地 `/internal/mcp/:room`。工具循环完全由 dsh 执行。
- `runtime/compaction.mjs`：继承原生 `BasicCompactionEngine`，替换成主持交接摘要，保留原生压缩阈值、保留区和持久化机制。

GM profile 禁用编程文件、终端、子代理和默认 headless 任务入口。persona 使用完整替换和 runtime context suppression，内容来自简短主持职责与规则速查。世界资料列出索引、按需检索；不把整个设定库常驻系统提示。

运行插件不直接请求 provider，不解析文字模拟工具调用，不编写独立循环。原生 MCP 工具名显示为 `mcp__table__context_get` 等。命名层级中的点在 MCP 名字里用下划线表示。

## 日志与统计

网页只接收“正在查阅/裁决/等待回应”等状态和已发布内容。原生文本、推理与工具参数留在服务端会话目录。每轮保存耗时、模型调用和可取得 token；每次工具调用保存名称、成功/错误、耗时和输入输出大小。原生 `inputTokens` 是**未缓存输入**；缓存读写和输出另外统计，不能把未缓存输入冒充全部上下文成本。输出可能包含推理 token。

强制杀进程时未返回的最后一次流式用量可能不可得，不能估算为零成本。`report-live.ts` 从已持久化原生事件补齐可取得统计。dsh 升级后先运行 doctor、工具测试及真实 smoke/长局验证，不能仅根据命令同名假定内部插件 API 兼容。
