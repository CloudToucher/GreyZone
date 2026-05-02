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
  const status = extractAnySection(body, ['状态与异常', '当前处境', '角色笔记'])
  const entries = [
    ...bulletItems(currentSituation, 3),
    ...bulletItems(status, 6),
  ]
  return Array.from(new Set(entries)).slice(0, 7)
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
    '你是《灰区：撤离》的 AI DM。当前是一次独立的“创建角色”会话，不是行动回合。',
    '把玩家的自然语言概念整理成一份可直接投入游戏的角色运行档案，并写入指定文件。',
    '',
    '## 必须写入的角色卡',
    args.outputPath,
    '',
    '## 先读',
    '- dm_guide/启动注入_AI_DM.md 中“角色创建”和“状态写回”相关段落',
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
    '- 正文必须包含“角色概念”和“当前处境”两个二级标题。',
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
    '## 先读',
    '- dm_guide/启动注入_AI_DM.md',
    '- dm_guide/DM速记_备忘.md 顶部局面卡',
    '- rules/公式速查卡.md',
    `- ${args.sharedBoardPath}`,
    `- ${args.packetPath}`,
    '',
    '## 你的工作',
    '- 根据回合包中的 publicIntents、sceneThreads、角色位置、分队、可见范围和私密意图，自动决定哪些角色纳入同一次处理。',
    '- 同场景、可互相感知、时间上可同步的角色应生成同一场景结果；分队或隔离的信息必须按可见性处理。',
    '- 未提交但同场景必须处理的角色，可按“犹豫、观察、跟随、保持原动作”保守处理，并在结果中标注为被动处理。',
    '- 只读取当前行动真正需要的规则、NPC、场景或物品文件；不要全量扫描资料库。',
    '- 发生已确认的伤势、能量、装备、位置、队伍/场景、关系、任务进度变化时，回写对应角色卡。',
    `- 更新 ${args.sharedBoardPath}：只写公开、浓缩、已确认的关键事实，不要把完整文学正文塞进去。`,
    `- 将玩家可读的完整 DM 回复写入 ${args.resultPath}。`,
    '- 不要编辑 table/control.yaml 或 table/seats.yaml，除非回合包明确要求处理控制权。',
    '- 不要向玩家可见输出泄露暗骰、NPC 内心、未遭遇真相或其他角色未知信息。',
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
    '保持结果既能直接给玩家读，又能作为下一轮 AI DM 的可靠摘要。',
  ].join('\n')
}
