# 主持工具契约

通用记录：`{id,kind,name,audience,data,secret}`。`data` 容纳开放属性；JSON 深度合并对象、整体替换数组。物品必须有真实 owner 和整数 quantity；数量可对应份、件或明确的计量单位。资源放 `data.resources`，灰币为 `cash`。能力条款、状态影响和用途判断由主持负责。

| 工具             | 作用                                     | 模型需要提供                                  |
| ---------------- | ---------------------------------------- | --------------------------------------------- |
| `context_get`    | 自动局势；批量记录/Markdown 全文         | 所缺 ID 或文档                                |
| `context_search` | 定向检索资料、记录、历史片段             | 查询词、范围、结果数量                        |
| `checks_resolve` | d20、属性、专长、优劣、对抗；立即落库    | 检定 ID、目的、依据、参与者、难度或对手、视野 |
| `state_apply`    | 批量暂存资料、资源、交易和状态           | 各项实际变化及原因                            |
| `time_advance`   | 时间、过期状态、伤势期限、周期消耗次数   | 共同经过分钟及原因                            |
| `turn_commit`    | 变化、叙述、账目、角色表、检查点同步发布 | 不同视野的叙述及各行动结果                    |
| `turn_ask`       | 向相关角色暂停询问                       | 真正需要玩家作的新决定                        |

普通动作：读取自动局势 → 必要时一次检定 → 按结果决定后果 → 一次 `turn_commit`。不确定才掷骰，独立检定可批量，依赖结果的继续分步。`finish=false` 可先发布有意义的阶段，随后继续；`finish=true` 要求每项冻结意图有 done、partial、deferred、interrupted 或 rejected。deferred 回到下一批行动板，玩家可修改或撤回。

`state_apply/turn_commit.changes` 支持：

- `create`：创造资料、NPC、地点、物资、关系、局部判例。玩家角色由玩家创建入口。
- `patch`：增量更新资料。可修订状态并在 reason 写清更正依据，不覆盖旧日志。物品改主人应走 transfer。
- `adjust`：按增量调整某个数值资源，拒绝负余额。
- `transfer`：从现持有人向接收者转移数量；price 是这次交易的**总价**，系统同时扣接收者灰币并付给原持有人。任一条件不成立全部回滚。
- `condition`：增改或解除状态。到 expiresAt 自动解除有明确期限的状态；deadline 只产生救治提醒，后果由主持处理。

`clock.data` 中 due 是绝对游戏分钟，every 为可选周期，costs 描述约定消耗；time 工具返回已到多少期，主持核对前提后统一扣除并更新 due/status。它不自动驱动 NPC 或造成伤害。

每个新操作给不同 key，同工具重试沿用原 key 和原参数。不同工具可以共用 key。检定 ID 的骰子和依据不可变；断线、重试和改 key 都不能改变已有结果。同一尝试不得换 ID 投到成功。

`context_get` 默认包含已掷骰和 pendingChanges，恢复后先沿用。规则包、记录索引与审计由系统维护；无需手写角色 Markdown、重复物品日志或生成未发生的两套结局。所有工具 JSON schema 以 `server/tools.ts` 为准。
