import type { Panel } from '../stores/workspace'

export interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: TreeNode[]
}

export interface FilePayload {
  path: string
  size: number
  mtime: number
  frontmatter: Record<string, unknown> | null
  content: string
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const data = await r.json()
      if (data?.error) msg = `${r.status} ${data.error}`
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}

export function fetchTree(panel: Panel): Promise<{ panel: Panel; tree: TreeNode }> {
  return getJSON(`/api/tree?panel=${panel}`)
}

export function fetchFile(panel: Panel, relPath: string): Promise<FilePayload> {
  const p = encodeURIComponent(relPath)
  return getJSON(`/api/file?panel=${panel}&path=${p}`)
}

export async function saveFile(
  panel: Panel,
  relPath: string,
  content: string,
): Promise<{ path: string; size: number; mtime: number }> {
  const p = encodeURIComponent(relPath)
  const r = await fetch(`/api/file?panel=${panel}&path=${p}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const data = await r.json()
      if (data?.error) msg = `${r.status} ${data.error}`
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return r.json()
}

export interface RoundStartBody {
  action: string
  character?: string
  prompt?: string
}

export async function startRound(body: RoundStartBody): Promise<{ roundId: string }> {
  const r = await fetch(`/api/round`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const data = await r.json()
      if (data?.error) msg = `${r.status} ${data.error}`
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return r.json()
}

export interface RoundEvent {
  type: 'start' | 'stdout' | 'stderr' | 'end' | 'error' | 'meta'
  data?: string
  code?: number | null
  ts: number
}

export type RoundHandler = (ev: RoundEvent) => void

/**
 * Subscribe to an opencode round via Server-Sent Events.
 * Returns a function that closes the connection.
 */
export function streamRound(roundId: string, onEvent: RoundHandler): () => void {
  const url = `/api/round/stream?id=${encodeURIComponent(roundId)}`
  const es = new EventSource(url)
  const types: RoundEvent['type'][] = ['start', 'stdout', 'stderr', 'end', 'error', 'meta']
  for (const t of types) {
    es.addEventListener(t, (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as RoundEvent
        onEvent(ev)
      } catch {
        /* ignore */
      }
    })
  }
  es.onerror = () => {
    /* EventSource will retry */
  }
  return () => es.close()
}

// ---------- Dice ----------

export interface DiceStats {
  dice: Record<string, number>
  raw: Record<string, number[]>
  total: number
  generatedAt: string | null
}

export async function fetchDiceStats(): Promise<DiceStats | null> {
  const r = await fetch(`/api/dice/stats`, { cache: 'no-store' })
  if (!r.ok) return null
  const data = await r.json()
  return data.stats as DiceStats | null
}

export async function generateDicePool(): Promise<{ message: string; stats: DiceStats | null }> {
  const r = await fetch(`/api/dice/generate?panel=dm`, { method: 'POST' })
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const data = await r.json()
      if (data?.error) msg = `${r.status} ${data.error}`
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return r.json()
}
