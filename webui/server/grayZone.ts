import { promises as fs } from 'node:fs'
import yaml from 'js-yaml'

export interface CharacterSummary {
  path: string
  name: string
  controller: string | null
  title: string
  concept: string
  currentSituation: string
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

function cleanSectionBody(section: string, maxLines = 4): string {
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('##') && !line.startsWith('>') && !line.startsWith('---'))
    .slice(0, maxLines)
    .join('\n')
    .trim()
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

    const concept = cleanSectionBody(extractSection(body, '角色概念')) || cleanSectionBody(body, 3)
    const currentSituation = cleanSectionBody(extractSection(body, '当前处境'))
    const name = typeof frontmatter?.name === 'string'
      ? frontmatter.name.trim()
      : relPath.split('/').pop()?.replace(/\.md$/i, '') || relPath

    return {
      path: relPath,
      title: relPath.split('/').pop()?.replace(/\.md$/i, '') || relPath,
      name,
      controller: typeof frontmatter?.controller === 'string' ? frontmatter.controller.trim() || null : null,
      concept,
      currentSituation,
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
    '你的目标是把玩家的自然语言概念整理成一份可以直接投入游戏的角色运行档案，并写入指定文件。',
    '',
    '## 必须写入的角色卡',
    args.outputPath,
    '',
    '## 先读取',
    '- dm_guide/启动注入_AI_DM.md 中“角色创建”和“状态写回”相关段落',
    '- characters/templates/角色卡模板.md',
    '- characters/templates/角色生成指南.md',
    '- table/shared_board.md',
    '',
    '## 创建角色会话规则',
    '- 这是新角色的新会话：不要继承其他角色的隐私、装备、伤势或历史状态。',
    '- 可以读取世界公开背景和角色模板；不要全量展开场景、敌人和剧情文件，除非角色概念明确触发。',
    '- 玩家没有给足细节时，替玩家做保守、可玩的裁定，不要把问题退回成表单。',
    '- 初始强度、装备、代价、关系和安全箱必须与《灰区：撤离》世界相容。',
    '',
    '## 硬性要求',
    `- Write the file at \`${args.outputPath}\`.`,
    `- Set frontmatter \`name: ${args.name?.trim() || '(choose a name that fits the character)'}\`.`,
    `- Set frontmatter \`controller: ${args.seatName}\`.`,
    '- Include frontmatter fields: name, controller, level, xp, blood, energy, attributes.',
    '- 正文必须包含“角色概念”和“当前处境”两个二级标题，方便界面提取摘要。',
    '- 角色卡中写清装备、安全箱、背包、关系、弱点/代价、当前地点和下一步可行动方向。',
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
    '# 灰区：撤离 - 行动回合会话',
    '',
    '你是《灰区：撤离》的 AI DM，正在处理一次文件落盘的行动回合。',
    '本次 opencode run 是一个新的执行会话，但必须通过回合包、共享看板、角色卡和 DM 速记承接游戏连续性。',
    '',
    '## 先读取',
    '- dm_guide/启动注入_AI_DM.md',
    '- dm_guide/DM速记_备忘.md 顶部局面卡',
    '- rules/公式速查卡.md',
    `- ${args.sharedBoardPath}`,
    `- ${args.packetPath}`,
    '- table/intents/DM.md 仅当回合包包含隐藏行动、DM 私密备注或需要主持人托管判断时读取',
    '',
    '## 你的工作',
    '- 根据回合包里的玩家公开行动、私密意图、长期目标、触发条件和角色卡来裁定本轮。',
    '- 只读取当前行动真正需要的规则、NPC、场景或物品文件；不要全量扫描资料库。',
    '- 发生已确认的伤势、能量、装备、位置、关系、任务进度变化时，回写对应角色卡。',
    `- 更新 ${args.sharedBoardPath}：只写玩家角色可见或已公开确认的信息。`,
    `- 将玩家可读的本轮结果写入 ${args.resultPath}。`,
    '- 不要编辑 table/control.yaml 或 table/seats.yaml，除非回合包明确要求处理控制权。',
    '- 不要向玩家可见输出泄露暗骰、NPC 内心、未遭遇真相或其他角色未知信息。',
    '',
    '## 结果文件合同',
    '结果文件必须使用以下标题，方便后续 AI 和玩家追踪：',
    '## 场景推进',
    '## 裁定',
    '## 已确认变化',
    '## 新信息',
    '## 下一步方向',
    '',
    '保持结果既能直接给玩家读，又能作为下一轮 AI DM 的可靠摘要。',
  ].join('\n')
}
