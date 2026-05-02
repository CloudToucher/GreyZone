# AI DM 回合包

- round_id: 69428df7-4bd6-41e3-bb6f-f5d6af0a8007
- generated_at: 2026-05-02T19:15:50.060Z
- host: AI DM
- trigger_reason: submitted:习风
- submitted_seats: 习风
- active_scene_seats: 习风
- result_path: table/rounds/69428df7-4bd6-41e3-bb6f-f5d6af0a8007/result.md
- conversation_policy: 每次处理都可开启新的 opencode 会话，但必须用本回合包、共享看板、角色卡和 table/conversations.md 承接连续性。

## 房间状态
- title: Gray Zone Table
- ruleset: gray-zone
- phase: idle

## AI 调度原则
- 没有人类 DM 选择玩家或裁定场景；你是唯一 AI DM。
- 优先处理同场景、可互相感知、时间上可同步的角色。
- 分队后生成独立场景线程；玩家只能看到自己角色可感知的信息。公开大事件再同步到共享看板。
- 本版执行可串行，但结果和状态写回必须保留 sceneId / partyId / location。

## 场景线程
```json
[
  {
    "id": "scene:contract-center-arrival",
    "location": "合同中心外环临时登记区",
    "partyIds": [
      "party:shadow-solo"
    ],
    "seatNames": [
      "习风"
    ],
    "characters": [
      {
        "name": "影子",
        "path": "characters/active/影子.md",
        "controller": "习风",
        "location": "合同中心外环临时登记区",
        "partyId": "party:shadow-solo"
      }
    ],
    "statuses": [
      {
        "seatName": "习风",
        "status": "submitted"
      }
    ]
  }
]
```

## 公开行动同步
```json
[
  {
    "seatName": "习风",
    "status": "submitted",
    "updatedAt": null,
    "publicText": "开始游戏",
    "longTerm": "",
    "characterNames": [
      "影子"
    ],
    "characterPaths": [
      "characters/active/影子.md"
    ],
    "sceneId": "scene:contract-center-arrival",
    "location": "合同中心外环临时登记区"
  }
]
```

## 本次玩家意图
### 习风

#### 公开行动
开始游戏

#### 私密意图（只给 AI DM）
(empty)

#### 长期目标
(empty)

#### 触发条件
(empty)

## 本次涉及角色摘要
### 影子 (characters/active/影子.md)
- controller: 习风
- location: 合同中心外环临时登记区
- sceneId: scene:contract-center-arrival
- partyId: party:shadow-solo
- visibilityScope: private
- semanticStatus: 所在: 合同中心外环临时登记区；位置: 合同中心外环临时登记区；场景: scene:contract-center-arrival；高共鸣超合金臂刃: 与神经接口绑定，近战突袭时更稳定，但长时间使用会留下可追踪的能量残痕。；UEG 识别风险: 高层或旧项目人员可能认出他的改造痕迹。；实验体本能: 面对拘束、白光实验室环境、军方口令时容易出现过激反应。
- inventory: 磨损灰连帽外套 x1；旧军靴 x1双；简易急救包 x1；打火机 x1；水壶 x1；干粮 x2天份；破布条 x若干；超合金科技臂刃 x1
- safeBox: 格1=空；格2=空

- 所在: 合同中心外环临时登记区
- 位置: 合同中心外环临时登记区
- 场景: scene:contract-center-arrival
- 队伍: party:shadow-solo


## 共享看板（只能把公开浓缩事实写回这里）
# 共享看板

## 公开局面
- 新桌面已准备好。
- 影子已抵达合同中心外环临时登记区。此信息仅作为公开开局锚点，不包含他的真实身份细节。

## 当前焦点
- 玩家提交第一步公开行动和可选私密意图。
- AI DM 将根据角色位置、场景、分队和提交状态自动处理开局。

## 最近确认变化
- 影子角色卡已建立。


## 额外备注
(none)

## 输出要求
- 将完整 DM 回复写入 table/rounds/69428df7-4bd6-41e3-bb6f-f5d6af0a8007/result.md。
- 同步更新 table/shared_board.md，但只写公开摘要。
- 更新角色卡中的血槽、能量、背包、安全箱、语义状态、location、sceneId、partyId、visibilityScope。
- 在结果中标注被动处理的未提交角色。
- 本次调用会登记到 table/conversations.md。
