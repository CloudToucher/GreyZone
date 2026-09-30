# dsh 接入

使用实际安装的 `@deepseek-ai/dsh` headless profile；已验证版本0.1.1-rc.2。Windows直接用Node运行 `lib/bin.js`，不经cmd/PowerShell包装。`DSH_BIN` 可指定该文件的绝对路径。

```text
node <安装目录>/lib/bin.js --profile headless --patch <临时目录>/game.patch.yml "Adjudicate the supplied game request."
```

完整任务放入临时JSON格式的YAML覆盖文件，避开Windows参数长度与转义问题。沿用dsh自己的模型配置和凭据；程序不读取或打印密钥。

游戏覆盖persona，关闭标准profile里的真实shell、文件、网页、subagent、工作流与代码执行工具。主持人的工具是应用层 `query / validate / reply / propose / amend`：每次模型返回结构化请求，服务端查资料、试算或保存相应交流、裁定、档案修订。行动环最多六轮，需要时才查询，不机械调用全部工具。实际写盘由原子事务执行。

角色创建采用同一主持persona，读取原作背景、当前世界、玩家的完整讨论和上版草案。每轮返回自然回应与完整修订草案；协议错误回传修正，辅助提醒允许说明理由后保留，最多三次尝试。讨论先保存席位凭据，因此刷新不会丢掉角色创建入口。

适合AI的工作方式是一个拥有完整裁定责任的主持人，按需使用有界游戏工具。角色表、临时条件、世界事件和先例都是它能维护的数据。没有用多个NPC代理自动轮流发言，也没有要求模型把一句玩家话拆成固定动作类别；这些做法会增加延迟并分散场景判断。每次headless进程通过显式档案与历史恢复上下文，不依赖隐藏的聊天会话状态。

候选方案同时包含成功/失败的结构化效果和可选世界编辑。校验错误可返回模型修正；超过预算、进程错误、超时或取消时不改变游戏状态，也不切换成假AI叙述。

单次进程默认240秒，可通过 `DSH_TIMEOUT_MS` 设为1000—600000毫秒。纠错或查询会再次调用，完整一轮可能更久，UI显示进度并可取消；目前不逐字流式展示模型文本。输出上限1MiB，UTF-8流解码。取消结束本次进程树并清理临时文件。`DSH_DEBUG=1` 可把JSON解析失败的模型输出写到 `.data/verification/invalid-model-output.txt`；该文件可能有GM秘密，不应公开。

`npm run doctor` 检查安装；`npm run doctor -- --live` 检查真实模型。`npx tsx scripts/smoke-creation.ts` 调用真实dsh完成自由角色、迭代修改、定制开局、纯交流与自创能力结算；`smoke-dsh.ts` 验证自由制作与交涉，`smoke-gm.ts` 验证模型生成NPC计划并由时钟执行。输出保存在 `.data/verification/`。smoke使用固定成功骰以检查状态路径，正常游戏使用系统随机数。浏览器回归使用独立确定性主持替身，不把它当真实模型验证。

此覆盖层针对标准headless配置，不是任意第三方插件的安全沙箱。它不会修改用户的全局profile。没有后台心跳，也不会在关闭网页后持续自动推进世界。
