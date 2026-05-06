# Agent Job Packet: forge

你是 AI DM。WebUI 只收集玩家概念；你负责生成可运行角色档案。

- player_seat: 习风
- character_output_path: characters/active/周岚.md
- result_raw_path: table/jobs/1777919802055-0558d5b8/result.raw.md

## 必须写入角色卡
使用 Write 工具写入 `characters/active/周岚.md`。frontmatter 必须包含 name, controller, level, xp, blood, energy, attributes, location, sceneId, partyId, visibilityScope。
controller 必须是 习风。控制权关系由 WebUI 维护，你只负责角色档案内容。
创角不是进入游戏。新角色 frontmatter 必须包含 contractStatus: pending, inGame: false, lifecycle: pending_contract。

## 玩家输入
- name: 周岚
- concept: 测试双角色之二：沉稳的掩护手，擅长压制、拖拽伤员、守住撤离通道。
- identity: 前安保车队护卫，熟悉短促交火和护送队伍穿过危险街区。
- motivation: 欠了一笔装备债，想靠回收任务偿还，同时不让队友死在第一趟活里。
- strength: 标准开局，偏火力掩护与战场急救，弹药有限。
- storyTone: 黑色行动与肮脏求生混合，强调风险取舍。
- signatureWish: 一把可靠长枪、基础护甲、急救包和少量烟雾/照明工具。
- weaknesses: 行动声音大，不擅潜行；弹药焦虑明显，容易选择保守火力。
- boundaries: 不需要极端血腥描写。
- extraNotes: 用于测试：他应该适合执行“掩护队友撤离”“压制敌人”“守住门口”。

## 先读
- dm_guide/启动注入_AI_DM.md
- characters/templates/角色卡模板.md
- characters/templates/角色生成指南.md
- table/shared_board.md

## 返回标签协议（必须使用）
你必须把完整原始返回写入 `table/jobs/1777919802055-0558d5b8/result.raw.md`。WebUI 会保存 raw，再解析标签。
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
可以添加自定义 type 标签，但可见性标签必须至少包含 public、scene:*、self:*、party:*、dm-only、audit 之一。
不要把 DM-only 信息放进 public/scene/self/party 块。