/**
 * Extract a character's vital stats for the StatusBar.
 *
 * Strategy (per user choice "B"):
 *   1. Prefer YAML frontmatter if present. Recognized keys:
 *        name, level, hp (current/max OR "80/80"), sp, ap, attributes (object)
 *   2. Otherwise return null (StatusBar simply won't render). This keeps v0
 *      backward-compatible with existing character sheets that have no
 *      frontmatter — the user's chosen path is to migrate sheets going forward.
 */

export interface CharStats {
  name?: string
  controller?: string
  level?: number | string
  xp?: number | string
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
  hp?: { cur: number; max: number }
  sp?: { cur: number; max: number }
  ap?: number | string
  attributes?: Record<string, number>
  raw: Record<string, unknown>
}

export interface SafeBoxSlot {
  label: string
  item: string
  empty: boolean
}

export interface FacilityState {
  name: string
  level: number
}

export interface InventoryEntry {
  item: string
  qty?: number
  raw: string
}

export interface CharacterSemanticState {
  summary: CharStats | null
  concept: string
  currentSituation: string
  keyRelations: string[]
  unconfirmedRisks: string[]
  safeBox: SafeBoxSlot[]
  baseInventory: InventoryEntry[]
  facilities: FacilityState[]
}

function parseRatio(v: unknown): { cur: number; max: number } | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return { cur: v, max: v }
  if (typeof v === 'string') {
    const m = v.match(/^\s*(-?\d+)\s*\/\s*(\d+)\s*$/)
    if (m) return { cur: parseInt(m[1], 10), max: parseInt(m[2], 10) }
    const n = parseInt(v, 10)
    if (!Number.isNaN(n)) return { cur: n, max: n }
  }
  if (typeof v === 'object' && v) {
    const obj = v as Record<string, unknown>
    const cur = Number(obj.cur ?? obj.current ?? obj.now)
    const max = Number(obj.max ?? obj.maximum ?? obj.total)
    if (!Number.isNaN(cur) && !Number.isNaN(max)) return { cur, max }
  }
  return undefined
}

function parseBlood(v: unknown): CharStats['blood'] | undefined {
  if (!v || typeof v !== 'object') return undefined
  const obj = v as Record<string, unknown>
  const total = Number(obj.total ?? obj.max ?? obj.current ?? obj.cur)
  const light = Number(obj.light ?? obj.soft ?? 0)
  const severe = Number(obj.severe ?? obj.heavy ?? 0)
  if (Number.isNaN(total)) return undefined
  return {
    total,
    light: Number.isNaN(light) ? 0 : light,
    severe: Number.isNaN(severe) ? 0 : severe,
    narrative: typeof obj.narrative === 'string' ? obj.narrative : undefined,
  }
}

function parseEnergy(v: unknown): CharStats['energy'] | undefined {
  if (!v || typeof v !== 'object') return undefined
  const obj = v as Record<string, unknown>
  const current = Number(obj.current ?? obj.cur ?? obj.now)
  const max = Number(obj.max ?? obj.maximum ?? obj.total)
  if (Number.isNaN(current) || Number.isNaN(max)) return undefined
  return { current, max }
}

export function extractStats(frontmatter: Record<string, unknown> | null): CharStats | null {
  if (!frontmatter) return null
  const fm = frontmatter

  // Heuristic: only treat this as a char-sheet frontmatter if it looks like one
  const hasCharSignal =
    'blood' in fm || 'energy' in fm || 'hp' in fm || 'sp' in fm || 'attributes' in fm || 'level' in fm || 'name' in fm || 'controller' in fm || 'xp' in fm
  if (!hasCharSignal) return null

  const stats: CharStats = { raw: fm }
  if (typeof fm.name === 'string' || typeof fm.name === 'number') stats.name = String(fm.name)
  if (typeof fm.controller === 'string' && fm.controller.trim()) {
    stats.controller = fm.controller.trim()
  }
  if (fm.level != null) stats.level = fm.level as number | string
  if (fm.xp != null) stats.xp = fm.xp as number | string
  const blood = parseBlood(fm.blood)
  if (blood) stats.blood = blood
  const energy = parseEnergy(fm.energy)
  if (energy) stats.energy = energy
  const hp = parseRatio(fm.hp)
  if (hp) stats.hp = hp
  const sp = parseRatio(fm.sp)
  if (sp) stats.sp = sp
  if (fm.ap != null) stats.ap = fm.ap as number | string
  if (fm.attributes && typeof fm.attributes === 'object') {
    const attrs: Record<string, number> = {}
    for (const [k, v] of Object.entries(fm.attributes as Record<string, unknown>)) {
      const n = Number(v)
      if (!Number.isNaN(n)) attrs[k] = n
    }
    if (Object.keys(attrs).length) stats.attributes = attrs
  }
  return stats
}

export function extractController(frontmatter: Record<string, unknown> | null): string | null {
  if (!frontmatter || typeof frontmatter.controller !== 'string') return null
  const trimmed = frontmatter.controller.trim()
  return trimmed || null
}

function extractSection(content: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`##\\s*${escaped}[\\s\\S]*?(?=\\n##|\\n---|$)`)
  const m = content.match(re)
  return m?.[0] || ''
}

function collectBulletLines(section: string): string[] {
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)
}

function extractConcept(content: string): string {
  const section = extractSection(content, '角色概念')
  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('##') && !line.startsWith('>') && !line.startsWith('---'))
  if (lines.length) return lines.slice(0, 6).join('\n').trim()
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('---'))
    .slice(0, 3)
    .join('\n')
    .trim()
}

function extractCurrentSituation(content: string): string {
  const section = extractSection(content, '当前处境')
  const bullets = collectBulletLines(section)
  if (bullets.length) return bullets.join('\n')
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('##') && !line.startsWith('>') && !line.startsWith('---'))
    .slice(0, 4)
    .join('\n')
    .trim()
}

function extractSubSection(section: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`###\\s*${escaped}[\\s\\S]*?(?=\\n###|\\n##|\\n---|$)`)
  const m = section.match(re)
  return m?.[0] || ''
}

function extractKeyRelations(content: string): string[] {
  const section = extractSection(content, '动机、关系与压力')
  const relationSection = extractSubSection(section, '重要关系')
  const debtSection = extractSubSection(section, '债务 / 承诺 / 挂念')
  return [...collectBulletLines(relationSection), ...collectBulletLines(debtSection)]
}

function extractUnconfirmedRisks(content: string): string[] {
  const section = extractSection(content, '状态与异常')
  const riskBlock = section.match(/###\s*未确认风险\s*\/\s*可疑迹象[\s\S]*?(?=\n###|\n##|\n---|$)/)
  return collectBulletLines(riskBlock?.[0] || '')
}

export function parseCharacterSemanticState(
  frontmatter: Record<string, unknown> | null,
  content: string,
): CharacterSemanticState {
  const safeBox: SafeBoxSlot[] = []
  const baseInventory: InventoryEntry[] = []
  const facilities: FacilityState[] = []

  const facMatches = content.match(/\|\s*(医疗室|工坊|军械库|情报中心|生活区)\s*\|\s*(\d+)\s*\|/g)
  if (facMatches) {
    for (const m of facMatches) {
      const parts = m.split('|').map((s) => s.trim())
      const name = parts[1]
      const level = parseInt(parts[2], 10)
      if (name) facilities.push({ name, level: Number.isNaN(level) ? 0 : level })
    }
  }

  const safeBoxSection = content.match(/###\s*安全箱[\s\S]*?(?=\n##|\n---|$)/)
  if (safeBoxSection) {
    const lines = safeBoxSection[0].split('\n')
    for (const l of lines) {
      const m = l.match(/\|\s*(?:格\s*(\d+)|格(\d+)|(\d+))\s*\|\s*(.+?)\s*\|/)
      if (!m) continue
      const labelNum = m[1] || m[2] || m[3] || String(safeBox.length + 1)
      const item = (m[4] || '').trim()
      safeBox.push({
        label: `格${labelNum}`,
        item,
        empty: !item || item === '空' || item === '—',
      })
    }
  }

  const invSection = content.match(/###\s*基地库存[\s\S]*?(?=\n##|\n---|$)/)
  if (invSection) {
    const lines = invSection[0].split('\n')
    for (const l of lines) {
      const m = l.match(/\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|/)
      if (!m) continue
      const item = m[1].trim()
      const qty = parseInt(m[2], 10)
      if (!item || item === '物品' || item.match(/（空）|^\s*$/)) continue
      baseInventory.push({
        item,
        qty: Number.isNaN(qty) ? undefined : qty,
        raw: l.trim(),
      })
    }
  }

  return {
    summary: extractStats(frontmatter),
    concept: extractConcept(content),
    currentSituation: extractCurrentSituation(content),
    keyRelations: extractKeyRelations(content),
    unconfirmedRisks: extractUnconfirmedRisks(content),
    safeBox,
    baseInventory,
    facilities,
  }
}

export function isCharacterPath(p: string): boolean {
  return p.startsWith('characters/active/') && p.toLowerCase().endsWith('.md')
}
