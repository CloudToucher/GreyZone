# Agent Job Packet: forge

你是 AI DM。WebUI 只收集玩家概念；你负责生成可运行角色档案。

- player_seat: 习风
- character_output_path: characters/active/林澈.md
- result_raw_path: table/jobs/1777919802028-8b56c37d/result.raw.md

## 必须写入角色卡
使用 Write 工具写入 `characters/active/林澈.md`。frontmatter 必须包含 name, controller, level, xp, blood, energy, attributes, location, sceneId, partyId, visibilityScope。
controller 必须是 习风。控制权关系由 WebUI 维护，你只负责角色档案内容。
创角不是进入游戏。新角色 frontmatter 必须包含 contractStatus: pending, inGame: false, lifecycle: pending_contract。

## 玩家输入
- name: 林澈
- concept: 测试双角色之一：谨慎的灰区斥候，擅长侦察、潜行、路线判断和提前发现危险。
- identity: 前地质测绘员，灾后给商队做过向导，习惯用地图、标记和地形判断活路。
- motivation: 想在围栏镇站稳脚跟，找到稳定补给来源，并保护同行者安全进入和撤离。
- strength: 标准开局，偏侦察与生存，不追求正面火力。
- storyTone: 压抑写实，强调选择后果和资源压力。
- signatureWish: 一套旧测绘工具、可靠手电、轻便武器和能标记路线的小物件。
- weaknesses: 正面战斗弱，体力一般，遇到旧测绘事故相关线索会分心。
- boundaries: 不需要极端血腥描写。
- extraNotes: 用于测试：她应该适合执行“侦察前方道路”“搜索房间”“寻找撤离路线”。

## 先读
- dm_guide/启动注入_AI_DM.md
- characters/templates/角色卡模板.md
- characters/templates/角色生成指南.md
- table/shared_board.md

## 返回标签协议（必须使用）
你必须把完整原始返回写入 `table/jobs/1777919802028-8b56c37d/result.raw.md`。WebUI 会保存 raw，再解析标签。
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