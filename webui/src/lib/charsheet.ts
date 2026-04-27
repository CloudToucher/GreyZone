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
  level?: number | string
  hp?: { cur: number; max: number }
  sp?: { cur: number; max: number }
  ap?: number | string
  attributes?: Record<string, number>
  raw: Record<string, unknown>
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

export function extractStats(frontmatter: Record<string, unknown> | null): CharStats | null {
  if (!frontmatter) return null
  const fm = frontmatter

  // Heuristic: only treat this as a char-sheet frontmatter if it looks like one
  const hasCharSignal =
    'hp' in fm || 'sp' in fm || 'attributes' in fm || 'level' in fm || 'name' in fm
  if (!hasCharSignal) return null

  const stats: CharStats = { raw: fm }
  if (typeof fm.name === 'string' || typeof fm.name === 'number') stats.name = String(fm.name)
  if (fm.level != null) stats.level = fm.level as number | string
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

export function isCharacterPath(p: string): boolean {
  return p.startsWith('characters/active/') && p.toLowerCase().endsWith('.md')
}
