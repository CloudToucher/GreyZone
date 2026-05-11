import { promises as fs } from 'node:fs'
import yaml from 'js-yaml'

export interface CharacterSummary {
  path: string
  name: string
  controller: string | null
  title: string
  concept: string
  currentSituation: string
  location: string
  sceneId: string
  partyId: string
  visibilityScope: 'private' | 'scene' | 'public'
  lifecycle: 'pending_contract' | 'active'
  contractStatus: string
  inGame: boolean
  inventory: string[]
  safeBox: Array<{ label: string; item: string; empty: boolean }>
  semanticStatus: string[]
  stats: {
    level?: string | number
    xp?: string | number
    blood?: {
      total: number
      light: number
      severe: number
      narrative?: string
    }
    energy?: {
      current: number
      max: number
    }
    hp?: string
    sp?: string
    ap?: string | number
    attributes?: Record<string, number>
  }
}

function splitFrontmatter(text: string): {
  frontmatter: Record<string, unknown> | null
  body: string
} {
  if (!text.startsWith('---')) return { frontmatter: null, body: text }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { frontmatter: null, body: text }
  const raw = text.slice(3, end).replace(/^\r?\n/, '')
  const body = text.slice(end + 4).replace(/^\r?\n/, '')
  try {
    const data = yaml.load(raw)
    if (data && typeof data === 'object') {
      return { frontmatter: data as Record<string, unknown>, body }
    }
  } catch {
    /* ignore invalid frontmatter */
  }
  return { frontmatter: null, body: text }
}

function extractSection(content: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`##\\s*${escaped}[\\s\\S]*?(?=\\n##|\\n---|$)`)
  return content.match(re)?.[0] || ''
}

function extractAnySection(content: string, titles: string[]) {
  for (const title of titles) {
    const section = extractSection(content, title)
    if (section) return section
  }
  return ''
}

function cleanSectionBody(section: string, maxLines = 4): string {
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('##') && !line.startsWith('>') && !line.startsWith('---'))
    .slice(0, maxLines)
    .join('\n')
    .trim()
}

function frontmatterString(frontmatter: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = frontmatter?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function slug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function extractLocation(body: string, frontmatter: Record<string, unknown> | null) {
  const direct = frontmatterString(frontmatter, ['location', '地点', '当前位置', 'current_location'])
  if (direct) return direct
  const section = extractAnySection(body, ['当前处境', '状态与异常', '角色笔记'])
  for (const line of section.split('\n')) {
    const match = line.match(/(?:所在|位置|地点|场景|当前位置)\s*[:：]\s*(.+)$/)
    if (match?.[1]?.trim()) return match[1].trim().replace(/^[-*]\s*/, '')
  }
  return '未定位'
}

function tableRows(section: string) {
  const rows: string[][] = []
  for (const line of section.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    if (/^\|\s*-+/.test(trimmed)) continue
    const cells = trimmed.split('|').map((cell) => cell.trim()).filter(Boolean)
    if (cells.length) rows.push(cells)
  }
  return rows
}

function tableItems(section: string, limit = 8) {
  const items: string[] = []
  for (const cells of tableRows(section)) {
    const first = cells[0]
    if (!first || /物品|装备|部位|格位|内容|项目|状态项|名称/.test(first)) continue
    if (/^(空|无|—|-)$/.test(first)) continue
    const qty = cells[1] && !/备注|当前值|内容/.test(cells[1]) ? ` x${cells[1]}` : ''
    items.push(`${first}${qty}`)
    if (items.length >= limit) break
  }
  return Array.from(new Set(items))
}

function bulletItems(section: string, limit = 5) {
  return section
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('|') && !line.startsWith('---'))
    .slice(0, limit)
}

function extractInventory(body: string) {
  const resource = extractAnySection(body, ['起始资源与装备', '装备与物资', '装备'])
  const withoutSafeBox = resource.split(/###\s*安全箱/)[0]
  const sections = [
    extractAnySection(body, ['随身携带', '背包', '背包 / 随身物品']),
    withoutSafeBox,
  ].join('\n')
  return tableItems(sections, 12).filter((item) => !/^格\d+\s*x/i.test(item) && !/x空/.test(item))
}

function extractSafeBox(body: string) {
  const section = extractAnySection(body, ['安全箱'])
  const slots: Array<{ label: string; item: string; empty: boolean }> = []
  for (const cells of tableRows(section)) {
    if (cells.length < 2 || /格位|内容/.test(cells[0])) continue
    const label = cells[0]
    const item = cells[1] || ''
    if (!/^格/.test(label)) continue
    slots.push({
      label,
      item,
      empty: !item || /^(空|无|—|-)$/.test(item),
    })
  }
  return slots
}

function extractSemanticStatus(body: string, currentSituation: string) {
  const status = extractAnySection(body, ['状态与异常', '角色笔记'])
  const explicit = bulletItems(status, 6)
  if (explicit.length) return Array.from(new Set(explicit)).slice(0, 7)
  return Array.from(new Set(bulletItems(currentSituation, 3))).slice(0, 7)
}

export async function readCharacterSummary(absPath: string, relPath: string): Promise<CharacterSummary | null> {
  try {
    const content = await fs.readFile(absPath, 'utf8')
    const { frontmatter, body } = splitFrontmatter(content)

    const blood = (() => {
      if (!frontmatter?.blood || typeof frontmatter.blood !== 'object') return undefined
      const obj = frontmatter.blood as Record<string, unknown>
      const total = Number(obj.total ?? obj.max ?? obj.current ?? obj.cur)
      if (Number.isNaN(total)) return undefined
      return {
        total,
        light: Number(obj.light ?? 0) || 0,
        severe: Number(obj.severe ?? 0) || 0,
        narrative: typeof obj.narrative === 'string' ? obj.narrative : undefined,
      }
    })()

    const energy = (() => {
      if (!frontmatter?.energy || typeof frontmatter.energy !== 'object') return undefined
      const obj = frontmatter.energy as Record<string, unknown>
      const current = Number(obj.current ?? obj.cur ?? obj.now)
      const max = Number(obj.max ?? obj.maximum ?? obj.total)
      if (Number.isNaN(current) || Number.isNaN(max)) return undefined
      return { current, max }
    })()

    const stats = {
      level: frontmatter?.level as string | number | undefined,
      xp: frontmatter?.xp as string | number | undefined,
      blood,
      energy,
      hp: frontmatter?.hp ? String(frontmatter.hp) : undefined,
      sp: frontmatter?.sp ? String(frontmatter.sp) : undefined,
      ap: frontmatter?.ap as string | number | undefined,
      attributes: typeof frontmatter?.attributes === 'object' && frontmatter.attributes
        ? Object.fromEntries(
            Object.entries(frontmatter.attributes as Record<string, unknown>)
              .map(([key, value]) => [key, Number(value)])
              .filter(([, value]) => !Number.isNaN(value)),
          )
        : undefined,
    }

    const concept = cleanSectionBody(extractAnySection(body, ['角色概念'])) || cleanSectionBody(body, 3)
    const currentSituation = cleanSectionBody(extractAnySection(body, ['当前处境']))
    const name = typeof frontmatter?.name === 'string'
      ? frontmatter.name.trim()
      : relPath.split('/').pop()?.replace(/\.md$/i, '') || relPath
    const controller = typeof frontmatter?.controller === 'string' ? frontmatter.controller.trim() || null : null
    const location = extractLocation(body, frontmatter)
    const sceneId = frontmatterString(frontmatter, ['sceneId', 'scene_id', '场景'])
      || `scene:${slug(location) || 'default'}`
    const partyId = frontmatterString(frontmatter, ['partyId', 'party_id', '队伍'])
      || `party:${slug(location) || slug(controller || relPath) || 'default'}`
    const visibility = frontmatterString(frontmatter, ['visibilityScope', 'visibility_scope', '可见范围'])
    const contractStatus = frontmatterString(frontmatter, ['contractStatus', 'contract_status', '合同状态'])
      || 'pending'
    const lifecycleRaw = frontmatterString(frontmatter, ['lifecycle', 'gameLifecycle', 'game_lifecycle'])
    const inGame = frontmatter?.inGame === true || frontmatter?.in_game === true || /^(signed|active|joined|已签约|入局)$/i.test(contractStatus)

    return {
      path: relPath,
      title: relPath.split('/').pop()?.replace(/\.md$/i, '') || relPath,
      name,
      controller,
      concept,
      currentSituation,
      location,
      sceneId,
      partyId,
      visibilityScope: visibility === 'public' || visibility === '公开'
        ? 'public'
        : visibility === 'scene' || visibility === '同场景'
          ? 'scene'
          : 'private',
      lifecycle: inGame || lifecycleRaw === 'active' ? 'active' : 'pending_contract',
      contractStatus,
      inGame,
      inventory: extractInventory(body),
      safeBox: extractSafeBox(body),
      semanticStatus: extractSemanticStatus(body, currentSituation),
      stats,
    }
  } catch {
    return null
  }
}

export function createForgePrompt(args: {
  seatName: string
  outputPath: string
  name?: string
  concept?: string
  identity?: string
  motivation?: string
  strength?: string
  storyTone?: string
  signatureWish?: string
  weaknesses?: string
  boundaries?: string
  extraNotes?: string
}) {
  return [
    '# 灰区：撤离 - 创建角色新会话',
    '',
    '你是《灰区：撤离》的 AI DM。当前是一次独立的"创建角色"会话，不是行动回合。',
    '把玩家的自然语言概念整理成一份可直接投入游戏的角色运行档案，并写入指定文件。',
    '',
    `## 你必须写入文件 \`${args.outputPath}\`（使用 Write 工具）`,
    `这是 WebUI 唯一能读取的输出通道。WebUI 不读取 stdout，只读取文件系统中的内容。`,
    '',
    '## 先读',
    '- dm_guide/启动注入_AI_DM.md 中"角色创建"和"状态写回"相关段落',
    '- characters/templates/角色卡模板.md',
    '- characters/templates/角色生成指南.md',
    '- table/shared_board.md',
    '',
    '## 创建规则',
    '- 这是新角色的新会话：不要继承其他角色的隐私、装备、伤势或历史状态。',
    '- 可以读取公开背景和角色模板；不要全量展开场景、敌人和剧情文件，除非角色概念明确触发。',
    '- 玩家没有给足细节时，替玩家做保守、可玩的裁定，不要把问题退回成表单。',
    '- 初始强度、装备、代价、关系和安全箱必须与世界相容。',
    '',
    '## 硬性要求',
    `- Write the file at \`${args.outputPath}\`.`,
    `- Set frontmatter \`name: ${args.name?.trim() || '(choose a name that fits the character)'}\`.`,
    `- Set frontmatter \`controller: ${args.seatName}\`.`,
    '- Include frontmatter fields: name, controller, level, xp, blood, energy, attributes, location, sceneId, partyId, visibilityScope.',
    '- 正文必须包含"角色概念"和"当前处境"两个二级标题。',
    '- 角色卡中写清装备、背包、安全箱、关系、弱点/代价、当前地点和下一步可行动方向。',
    '- 如修改共享局面，只能写公开信息到 table/shared_board.md。',
    '',
    '## 玩家给出的角色名',
    args.name?.trim() || '(not provided)',
    '',
    '## 角色概念',
    args.concept?.trim() || '(not provided)',
    '',
    '## 身份 / 背景',
    args.identity?.trim() || '(not provided)',
    '',
    '## 动机 / 想玩的方向',
    args.motivation?.trim() || '(not provided)',
    '',
    '## 期望初始强度',
    args.strength?.trim() || '(not provided)',
    '',
    '## 故事调性',
    args.storyTone?.trim() || '(not provided)',
    '',
    '## 标志性愿望',
    args.signatureWish?.trim() || '(not provided)',
    '',
    '## 可接受弱点 / 代价',
    args.weaknesses?.trim() || '(not provided)',
    '',
    '## 内容边界',
    args.boundaries?.trim() || '(not provided)',
    '',
    '## 补充说明',
    args.extraNotes?.trim() || '(not provided)',
    '',
    '## 回复格式',
    '写完文件后，用以下标题回复，便于玩家阅读和回合索引追踪：',
    '## 角色概念',
    '## 初始状态',
    '## 初始装备',
    '## 强项',
    '## 代价与风险',
    '## 当前处境',
    '## 已写入文件',
    '',
    '## 完成标记 — 极其重要',
    `在结果文件的最后一行，必须追加以下机器可读标记（一字不差）：`,
    `\`\`\``,
    `<!-- FORGE_DONE {"name":"<角色名>","status":"ok"} -->`,
    `\`\`\``,
    'WebUI 通过检测此标记来判定创角已完成。',
  ].join('\n')
}

export function createRoundPrompt(args: {
  packetPath: string
  resultPath: string
  sharedBoardPath: string
}) {
  return [
    '# 灰区：撤离 - AI DM 行动处理',
    '',
    '你是《灰区：撤离》的唯一 AI DM。没有人类 DM 为你选择玩家、裁定场景或编排分队。',
    '本次 opencode run 是新的执行会话，但必须通过回合包、共享看板、角色卡和 table/conversations.md 承接游戏连续性。',
    '',
    '## 你的输出：文件即协议',
    `你必须把完整的 DM 叙事回复写入 \`${args.resultPath}\`。这是你与 WebUI 的唯一通信渠道。`,
    'WebUI 不会读取你的 stdout；它只读取文件系统中的 result.md。',
    '',
    '## 先读',
    '- dm_guide/启动注入_AI_DM.md',
    '- dm_guide/DM速记_备忘.md 顶部局面卡',
    '- rules/公式速查卡.md',
    `- ${args.sharedBoardPath}`,
    `- ${args.packetPath}`,
    '',
    '## 你的工作',
    '1. 根据回合包中的 publicIntents、sceneThreads、角色位置、分队、可见范围和私密意图，自动决定哪些角色纳入同一次处理。',
    '2. 同场景、可互相感知、时间上可同步的角色应生成同一场景结果；分队或隔离的信息必须按可见性处理。',
    '3. 未提交但同场景必须处理的角色，可按"犹豫、观察、跟随、保持原动作"保守处理，并在结果中标注为被动处理。',
    '4. 只读取当前行动真正需要的规则、NPC、场景或物品文件；不要全量扫描资料库。',
    '5. 发生已确认的伤势、能量、装备、位置、队伍/场景、关系、任务进度变化时，回写对应角色卡。',
    `6. 更新 \`${args.sharedBoardPath}\`：只写公开、浓缩、已确认的关键事实。`,
    `7. 将玩家可读的完整 DM 回复写入 \`${args.resultPath}\`（使用 Write 工具写入文件）。`,
    '8. 不要编辑 table/control.yaml 或 table/seats.yaml。',
    '9. 不要向玩家可见输出泄露暗骰、NPC 内心、未遭遇真相或其他角色未知信息。',
    '10. 多角色同时行动时，必须写成一个协同场景：说明谁掩护谁、谁发现线索、谁承担风险、谁消耗资源；不要拆成互不相关的角色小报告。',
    '11. 选择必须有后果：休整、急行、硬冲、绕行、交涉、撤离都要在风险、耗时、资源或信息上产生差异。',
    '',
    '## 结果文件合同',
    '结果文件必须使用以下标题，方便后续 AI 和玩家追踪：',
    '## DM 回复',
    '## 场景推进',
    '## 裁定',
    '## 已确认变化',
    '## 新信息',
    '## 下一步方向',
    '',
    '## 玩家可读性要求',
    '- ## DM 回复 开头就是文学化结果，不要先写 job、文件路径、审计说明或技术日志。',
    '- ## 已确认变化 必须按项目列出伤势、弹药/装备、能量、位置、战利品、线索；没有变化也写“暂无明确变化”。',
    '- ## 下一步方向 必须给 2-3 个可直接复制到行动卡的一句话动作，例如“侦察前方道路”“掩护队友撤离”“搜索房间”。',
    '- 如果使用 :::gz 标签，以上三个标题必须全部位于同一个 public 标签块内部，不能写在标签块外。',
    '',
    '## 完成标记 — 极其重要',
    `在结果文件的最后一行，必须追加以下机器可读标记（一字不差）：`,
    `\`\`\``,
    `<!-- ROUND_DONE {"round_id":"<使用 packet 中的 round_id>","status":"ok"} -->`,
    `\`\`\``,
    'WebUI 通过检测此标记来判定回合已完成，并将结果推送给玩家。',
    '没有此标记，WebUI 会认为回合失败/无输出，玩家什么也看不到。',
    '',
  ].join('\n')
}

export function createWelcomePrompt(args: {
  packetPath: string
  resultPath: string
  sharedBoardPath: string
}) {
  return [
    '# 灰区：撤离 - 进入灰区 / 欢迎场景',
    '',
    '你是《灰区：撤离》的唯一 AI DM。',
    '玩家刚点击了"进入灰区"按钮。现在你要为他们生成初始欢迎场景。',
    '',
    '## 你的输出：文件即协议',
    `你必须把完整的欢迎场景写入 \`${args.resultPath}\`。这是你与 WebUI 的唯一通信渠道。`,
    'WebUI 不读取 stdout；只读取文件系统中的 result.md。',
    '',
    '## 先读',
    '- dm_guide/启动注入_AI_DM.md',
    '- dm_guide/DM速记_备忘.md 顶部局面卡',
    '- rules/公式速查卡.md',
    '- rules/00_游戏约定.md（了解游戏宪法和玩家权利）',
    `- ${args.sharedBoardPath}`,
    `- ${args.packetPath}`,
    '- characters/active/*.md（所有角色卡）',
    '',
    '## 你的任务（必须严格执行）',
    '',
    '灰区的核心入门仪式是"签署回收者入职合同"。但仅在游戏首次启动时触发。',
    '你必须根据共享看板和角色卡状态判断当前阶段。',
    '',
    '1. **读取角色卡**：了解所有已存在的角色身份、背景、当前地点。',
    '2. **读取共享看板**：判断当前游戏阶段。',
    '3. **判断并执行**：',
    '   - A) 共享看板显示"游戏尚未开始"或"等待玩家进入灰区" → 首次进入 → 产出完整入职场景',
    '   - B) 共享看板已有游戏状态（地点、时间、事件） → 游戏已在进行中 → 产出当前场景叙事',
    '4. **首次进入（情况 A）**：',
    '   - a) 描写围栏镇合同中心大厅的氛围',
    '   - b) 合同职员将《回收者入职合同》推到角色面前',
    '   - c) 合同中必须包含条款摘要：70/30分成、安全箱2格、灰币限围栏镇、签名即正式回收者',
    '   - d) 大厅内其他回收者候选人的对话（提供情报线索）',
    '5. **重连/已在进行中（情况 B）**：',
    '   - a) 根据共享看板中的时间、地点、角色位置，产出当前场景的文学性叙事',
    '   - b) 明确告知玩家：这是当前游戏状态，不是新游戏',
    '   - c) 告知每个角色当前处境和可执行的下一步行动',
    '   - d) 不要重复合同场景——合同只在第一次签一次',
    '5. **在"可以做些什么"中必须包含直接、可执行的动作**，例如：',
    '   - "签署合同（在意图区写：我拿起笔签下名字）"',
    '   - "仔细阅读合同条款（在意图区写：我仔细翻看合同）"',
    '   - "观察大厅里的其他人（在意图区写：我环顾大厅）"',
    '   - "和合同职员搭话（在意图区写：我问合同职员……）"',
    '',
    '## 叙事铁律',
    '- **必须给出明确的行动方向**。不要只说"你可以做A、B、C"，要在每个选项后',
    '  附带一个可直接复制到意图区的示例行动文本。玩家需要知道具体写什么。',
    '- 使用文学性、沉浸式的灰区风格。包含感官细节（视觉、听觉、气味、温度）。',
    '- 为每个角色提供角色视角的当前处境描述。',
    '- 保持灰区的压抑、神秘感，但不要让氛围压倒信息传达。',
    '- **合同内容是必选项，不可省略**。即使合同职员今天"沉默寡言"，',
    '  他仍然会执行递合同的标准流程。沉默体现在态度，不体现在流程缺失。',
    '',
    `## 写入 \`${args.resultPath}\` 时使用以下格式`,
    '```',
    '# 灰区：撤离 — （场景标题）',
    '',
    '（文学性场景叙事，2-3 段，必须包含合同大厅和合同内容）',
    '',
    '## 当前局面',
    '（事实总结：时间、地点、活跃角色、合同核心条款）',
    '',
    '## 你的角色',
    '（每个角色的位置、状态、当前处境）',
    '',
    '## 可以做些什么',
    '- **选项 A**：在意图区写：`（示例文本）`',
    '- **选项 B**：在意图区写：`（示例文本）`',
    '- **选项 C**：在意图区写：`（示例文本）`',
    '- **选项 D**：在意图区写：`（示例文本）`',
    '',
    '## 下一步',
    '在右侧"提交行动"区域中，把你想做的行动写入"公开行动"文本框，然后点击"提交给 AI DM"。',
    '```',
    '',
    '## 完成标记 — 极其重要',
    `在结果文件的最后一行，必须追加以下标记：`,
    '```',
    '<!-- ROUND_DONE {"phase":"welcome","status":"ok"} -->',
    '```',
    'WebUI 检测到此标记后才认为欢迎场景已生成。没有此标记，玩家什么也看不到。',
    '',
    `同时更新 \`${args.sharedBoardPath}\`，写入公开事实：游戏已启动、角色当前局面、合同信息等。`,
  ].join('\n')
}

export function createDmSessionPrompt(args: {
  sharedBoardPath: string
  welcomeResultPath: string
  sessionSavePath?: string
}) {
  const restoreBlock = args.sessionSavePath
    ? [
        '',
        '### 会话恢复',
        `本次是新 DM 会话。上一会话保存的状态在 \`${args.sessionSavePath}\`。`,
        '请先读取该文件，了解上一会话的局面、剧情线和 NPC 状态，然后继续游戏。',
        '不要重新生成欢迎场景 — 直接产出当前场景叙事。',
        '',
      ].join('\n')
    : ''

  return [
    '# AI DM 会话 — 灰区：撤离',
    '',
    '你是灰区的 AI DM。你将在本次 opencode 会话中持续处理多轮玩家行动。你始终在线，不需要每轮重新介绍自己。',
    '',
    '## 你的输出：文件即协议',
    '你的所有输出都必须写入文件系统。WebUI 不读取 stdout，只读取文件。',
    '每次产出叙事结果后，必须在文件末尾追加完成标记。',
    '',
    '## 初始化（立即执行，仅一次）',
    '1. 读取 dm_guide/启动注入_AI_DM.md',
    '2. 读取 dm_guide/DM速记_备忘.md 顶部局面卡',
    '3. 读取 rules/公式速查卡.md',
    `4. 读取 ${args.sharedBoardPath}`,
    restoreBlock ? `4b. 读取 ${args.sessionSavePath}（会话恢复文件）` : '',
    '5. 列出 characters/active/ 目录，读取所有 .md 角色卡',
    '6. 根据共享看板判断游戏阶段：',
    '   若共享看板为初始状态（"游戏尚未开始"等）→ 产出"入职场景"（合同大厅 + 合同条款）',
    '   若共享看板已有游戏状态 → 产出"当前场景叙事"（展示角色当前位置、状态、局势）',
    '   不要在新连接时重复合同签约——合同只签一次',
    `7. 使用 Write 工具写入 ${args.welcomeResultPath}`,
    '',
    '欢迎叙事格式：',
    '```',
    '# 灰区：撤离 — （场景标题）',
    '',
    '（文学性场景叙事 2-4 段，包含感官细节）',
    '',
    '## 当前局面',
    '（事实性总结：时间、地点、角色、已知情报）',
    '',
    '## 你的角色',
    '（各角色位置、状态、处境）',
    '',
    '## 可以做些什么',
    '- （具体行动选项）',
    '',
    '## 下一步',
    '（鼓励玩家在意图区写入行动）',
    '```',
    '',
    '8. 在文件末尾追加完成标记：',
    '```',
    '<!-- ROUND_DONE {"phase":"welcome","status":"ok"} -->',
    '```',
    '9. 更新 table/shared_board.md（只写公开事实）',
    '',
    '## 处理循环（初始化完成后执行）',
    '',
    '初始化完成后，请立即进入处理循环。使用以下步骤：',
    '',
    '### 第一步：等待触发',
    '使用 bash 工具执行以下命令来等待下一轮触发：',
    '```bash',
    'elapsed=0; while [ $elapsed -lt 300 ] && [ ! -f table/dm_trigger ]; do sleep 3; elapsed=$((elapsed+3)); done; if [ -f table/dm_trigger ]; then cat table/dm_trigger; else echo "TIMEOUT"; fi',
    '```',
    'bash 超时设为 360000ms（6分钟）。',
    '',
    '### 第二步：处理回合',
    '如果上一步返回 "TIMEOUT"：写入 table/dm_heartbeat 文件（内容：`{"ts":"<当前ISO时间>","status":"alive"}`），然后回到第一步。',
    '',
    '如果上一步返回了内容（trigger 文件内容）：',
    '1. 解析 trigger 内容（YAML 格式，包含 round_id、packet_path、result_path）',
    '2. 读取 packet.md 获取本轮意图',
    '3. 按需读取相关角色卡、规则、场景文件',
    '4. 处理回合 — 裁决、叙事、状态变化',
    `5. 使用 Write 工具写入 result.md（对应 result_path）`,
    `6. 更新 ${args.sharedBoardPath}（只写公开浓缩事实）`,
    '7. 更新角色卡（blood, energy, inventory, location, sceneId, partyId 等 frontmatter）',
    '8. 在 result.md 末尾追加完成标记（使用 packet 中的 round_id）：',
    '   `<!-- ROUND_DONE {"round_id":"<round_id>","status":"ok"} -->`',
    '9. 使用 bash 删除 trigger 文件：`rm table/dm_trigger table/dm_trigger.lock 2>/dev/null`',
    '',
    '### 第三步：回到第一步',
    '处理完当前回合后，回到第一步继续等待下一次触发。',
    '',
    '## 回合结果格式',
    '每次处理回合后，result.md 必须包含以下标题：',
    '## DM 回复',
    '## 场景推进',
    '## 裁定',
    '## 已确认变化',
    '## 新信息',
    '## 下一步方向',
    '',
    '## DM 铁律',
    '- 只把公开、浓缩、已确认的事实写入 shared_board.md',
    '- 不要向玩家输出泄露暗骰、NPC 内心、未遭遇真相',
    '- 发生状态变化时立即回写角色卡 frontmatter',
    '- 每轮都必须追加完成标记，否则 WebUI 认为回合失败',
    '- 只读取当前回合需要的信息，不要全量扫描资料库',
    '- 多角色同场行动必须合写协同结果，不要拆成孤立报告',
    '- 每轮结尾都给 2-3 个可直接复制的一句话下一步行动',
    '',
    '## 会话上限',
    '- 当你处理了大约 20-25 轮后，在当前 result.md 中告知"会话即将切换"',
    '- 然后写入 table/session_save.md（包含当前局面摘要、活跃剧情线、重要 NPC 状态、DM 备忘）',
    '- 处理完当前轮后，不再进入等待循环，正常结束',
    '- Engine 将启动新会话，从 session_save.md 恢复状态',
    '',
  ].join('\n')
}

export function createAssistantPrompt(args: {
  question: string
  resultPath: string
  charSummary?: string
}) {
  return [
    '# 灰区：撤离 — 规则助手',
    '',
    '你是灰区的规则助手。你不是 AI DM — 你只负责回答玩家关于规则、机制、世界设定的问题。',
    '这是一次独立的"规则问答"会话。你不生成叙事、不裁决行动、不推进剧情。',
    '',
    '## 你的输出：文件即协议',
    `你必须把完整的回答写入 \`${args.resultPath}\`（使用 Write 工具）。`,
    'WebUI 不读取 stdout；只读取文件系统中的内容。',
    '',
    '## 玩家问题',
    args.question,
    '',
    '## 你的工作',
    '1. 按需读取 rules/ 目录下的相关规则文件',
    '2. 如果问题涉及角色，可读取 characters/active/ 下的角色卡',
    '3. 给出准确、简洁的规则解释',
    '4. 如果规则不明确，给出最常见的灰区裁定倾向',
    '5. 不得编造规则 — 所有引用必须来自规则文件',
    '6. 不得生成任何叙事内容',
    '',
    args.charSummary
      ? `## 角色上下文\n玩家当前控制的角色：\n${args.charSummary}`
      : '',
    '',
    '## 回答格式',
    '```',
    '## 规则说明',
    '',
    '（直接回答，引用具体规则来源）',
    '',
    '## 相关规则',
    '- （列出引用的规则文件路径）',
    '```',
    '',
    '## 完成标记 — 极其重要',
    `在结果文件的最后一行，追加以下标记：`,
    '```',
    '<!-- ASSISTANT_DONE {"status":"ok"} -->',
    '```',
    'WebUI 检测到此标记后才认为回答已完成。',
  ].join('\n')
}
