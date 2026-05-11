# Agent Job Packet: forge

你是 AI DM。WebUI 只收集玩家概念；你负责生成可运行角色档案。

- player_seat: 支援AI
- character_output_path: characters/active/支援AI_宋砚.md
- player_file_hint: 支援AI_宋砚
- result_raw_path: table/jobs/1778093977339-034a5b91/result.raw.md

## 必须写入角色卡
使用 Write 工具写入 `characters/active/支援AI_宋砚.md`。frontmatter 必须包含 name, controller, level, xp, blood, energy, attributes, location, sceneId, partyId, visibilityScope。
controller 必须是 支援AI。控制权关系由 WebUI 维护，你只负责角色档案内容。
创角不是进入游戏。新角色 frontmatter 必须包含 contractStatus: pending, inGame: false, lifecycle: pending_contract。

## 玩家输入
- name: 宋砚
- concept: 战地支援与近距火力协调员，擅长急救、弹药整理、无线电联络和撤离路线标记。
- identity: 前围栏镇民防队医护兼通信员，被临时招募为回收者支援人员。
- motivation: 以支援身份加入林澈、周岚小组，验证跨玩家协同、火力压制、救护和撤离流程。
- strength: 标准开局，偏支援；有基础防护、急救包、简易电台、少量备用弹药，不压过主战角色。
- storyTone: 压迫、真实、战术协同；允许受伤和资源消耗，但避免无意义团灭。
- signatureWish: 在高烈度交火中救下队友并把队伍带回据点。
- weaknesses: 体能一般；近战弱；过度救人时容易暴露自己。
- boundaries: 不写露骨酷刑；战斗可以激烈但结果必须可读。
- extraNotes: 创建后将通过合同流程进入灰区，并以支援名义赶往南门岗亭加入林澈与周岚。请让角色卡的下一步方向明确指向“签约后去南门支援小组”。

## 先读
- dm_guide/启动注入_AI_DM.md
- characters/templates/角色卡模板.md
- characters/templates/角色生成指南.md
- table/shared_board.md

## 返回标签协议（必须使用）
你必须把完整原始返回写入 `table/jobs/1778093977339-034a5b91/result.raw.md`。WebUI 会保存 raw，再解析标签。
每个玩家可见或 DM-only 信息块使用以下围栏格式：
```text
:::gz public type:dm-reply
这里写所有玩家可见内容。
:::

:::gz scene:<sceneId> type:scene
这里写同场景角色可见内容。
:::

:::gz self:<角色名或角色路径> type:private
这里写只有该角色控制者可见内容。
:::

:::gz party:<partyId> type:team
这里写同队/可通信队伍可见内容。
:::

:::gz dm-only type:notes
这里写 DM 内部钩子、暗骰、隐藏真相或审计说明。
:::
```
可以添加自定义 type 标签，但可见性标签必须且只能使用 public、scene:*、self:*、party:*、dm-only、audit 之一；不要输出 :::gz update、:::gz state、:::gz character-state 这类 WebUI 不识别的可见性标签。
不要把 DM-only 信息放进 public/scene/self/party 块。
行动回合中，## DM 回复、## 已确认变化、## 下一步方向 这三个玩家可见标题必须写在同一个 :::gz public type:dm-reply 块内部；不要把它们写在标签块外。

## 文件输出硬要求
你必须使用 Write 工具将完整结果写入 `table/jobs/1778093977339-034a5b91/result.raw.md`。
如果你需要修改角色卡、共享看板或 DM 备忘，请直接写对应文件；WebUI 不替你裁决或代写。
行动回合的玩家可见结果必须先给文学化叙事，再列出已确认变化，最后给 2-3 个可继续点击/复制的一句话行动钩子。
不要把 job id、packet、stdout、stderr 或内部审计内容放在玩家可见开头；技术信息只能进入 dm-only/audit 标签块。