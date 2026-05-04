# Agent Job Packet: action

WebUI 只负责整理角色行动卡；你是 AI DM，负责裁决、叙事、信息分层、状态写回和标签。

- triggered_by_player: 习风
- result_raw_path: table/jobs/1777798593577-89b9acf4/result.raw.md

## 当前共享看板
# 共享看板

## 公开局面
- 房间已初始化。铁壁安保公司围栏镇据点已签发《回收者入职文件包》（文号：TBA-FT-REC-2026-0503-SHA-001）。
- 新回收者「影子」（控制者：习风）已完成角色档案建立与预登记，等待前往登记窗口完成正式签约。

## 当前焦点
- 影子需前往登记窗口完成身份核验与合同签署。签约后将分配安全箱编号并获取首个任务派遣。

## 最近确认变化
- 影子角色档案已生成：等级 1，标准开局。潜行型刺客定位，配备消音手枪、战术直刀、轻型战术背心。
- 据点登记管理处已发放入职文件包，待签约生效。


## 本轮角色行动卡
### 影子
- characterPath: characters/active/影子.md
- playerSeat: 习风
- aiHosted: false

#### 公开行动
签字确认，去领装备，并且找地方入住

#### 私密意图
(empty)

#### 长期目标
(empty)

#### 触发条件
(empty)


## 同步场景内相关角色（按需读取完整角色卡）
### 影子
- path: characters/active/影子.md
- controller: 习风
- location: 围栏镇据点·登记处
- sceneId: init_shadow
- partyId: 影子
- visibilityScope: private
- status: 所在处境：围栏镇据点登记大厅。刚完成回收者身份预登记，等待领取正式入职文件包后完成签约。；近期目标：完成入职手续，了解灰区基本规则和可用资源，接第一个活儿。；眼前风险：身份审核可能被盘问；围栏镇本身是陌生环境，潜在威胁未知。
- inventory: 开锁工具（基础套） x1；战术手电 x1；应急医疗包 x1；单兵口粮 x2；水壶 x1；机械腕表 x1；灰色便帽 x1

- 所在处境：围栏镇据点登记大厅。刚完成回收者身份预登记，等待领取正式入职文件包后完成签约。
- 近期目标：完成入职手续，了解灰区基本规则和可用资源，接第一个活儿。
- 眼前风险：身份审核可能被盘问；围栏镇本身是陌生环境，潜在威胁未知。
- 可利用机会：新面孔意味着没有旧账——至少在围栏镇是这样。据点对回收者需求旺盛，活儿不会缺。


## 必须遵守
- 按 sceneId / partyId / 通信关系组织协同，不要把玩家身份直接当作角色行动主体。
- 需要写回状态时，更新对应角色卡 frontmatter 和正文当前处境。
- 只把公开确认事实写入 table/shared_board.md。
- 私密意图、隐藏真相、暗骰和 DM 备注只能进入 dm-only/audit 标签块。

## 返回标签协议（必须使用）
你必须把完整原始返回写入 `table/jobs/1777798593577-89b9acf4/result.raw.md`。WebUI 会保存 raw，再解析标签。
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

## 文件输出硬要求
你必须使用 Write 工具将完整结果写入 `table/jobs/1777798593577-89b9acf4/result.raw.md`。
如果你需要修改角色卡、共享看板或 DM 备忘，请直接写对应文件；WebUI 不替你裁决或代写。