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

function withPlayer(url: string, player?: string): string {
  if (!player) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}player=${encodeURIComponent(player)}`
}

export function fetchTree(panel: Panel, opts?: { player?: string }): Promise<{ panel: Panel; player?: string | null; tree: TreeNode }> {
  return getJSON(withPlayer(`/api/tree?panel=${panel}`, opts?.player))
}

export function fetchFile(panel: Panel, relPath: string, opts?: { player?: string }): Promise<FilePayload> {
  const p = encodeURIComponent(relPath)
  return getJSON(withPlayer(`/api/file?panel=${panel}&path=${p}`, opts?.player))
}

export async function saveFile(
  panel: Panel,
  relPath: string,
  content: string,
  opts?: { player?: string },
): Promise<{ path: string; size: number; mtime: number }> {
  const p = encodeURIComponent(relPath)
  const r = await fetch(withPlayer(`/api/file?panel=${panel}&path=${p}`, opts?.player), {
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

export interface ForgePayload {
  concept?: string
  identity?: string
  motivation?: string
  strength?: string
  storyTone?: string
  signatureWish?: string
  weaknesses?: string
  boundaries?: string
  extraNotes?: string
  fileHint?: string
}

export interface RoundStartBody {
  panel: Panel
  kind?: 'action' | 'forge'
  player?: string
  action: string
  character?: string
  prompt?: string
  forge?: ForgePayload
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
export function streamRound(roundId: string, onEvent: RoundHandler, onOpen?: () => void): () => void {
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
  es.onopen = () => {
    onOpen?.()
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

export interface OpencodeProbeResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  model: string
  title: string
}

export async function probeOpencode(): Promise<OpencodeProbeResult> {
  const r = await fetch('/api/opencode/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  const data = (await r.json()) as OpencodeProbeResult | { error?: string }
  if (!r.ok) {
    const msg = 'error' in data && data.error ? data.error : `probe failed (${r.status})`
    throw new Error(msg)
  }
  return data as OpencodeProbeResult
}
