/**
 * Dice pool endpoints — parse & regenerate tools/dice_pool.md
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface DiceStats {
  /** Total rolls remaining per die type */
  dice: Record<string, number>
  /** All remaining raw values (top = next to consume) */
  raw: Record<string, number[]>
  /** Total rolls left */
  total: number
  /** Generation timestamp */
  generatedAt: string | null
}

const POOL_PATH = 'tools/dice_pool.md'

function sendJSON(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

export function parsePool(text: string): DiceStats {
  const dice: Record<string, number> = {}
  const raw: Record<string, number[]> = {}
  let currentDie = ''
  let generatedAt: string | null = null

  for (const line of text.split('\n')) {
    const hMatch = line.match(/^##\s+(d\d+)/)
    if (hMatch) {
      currentDie = hMatch[1]
      dice[currentDie] = 0
      raw[currentDie] = []
      continue
    }
    const genMatch = line.match(/生成于\s+(.+)/)
    if (genMatch) generatedAt = genMatch[1].trim()
    if (!currentDie) continue
    const v = parseInt(line.trim(), 10)
    if (!Number.isNaN(v) && line.trim() !== '') {
      raw[currentDie].push(v)
      dice[currentDie] = (dice[currentDie] || 0) + 1
    }
  }

  const total = Object.values(dice).reduce((s, n) => s + n, 0)
  return { dice, raw, total, generatedAt }
}

export async function readDiceStats(workspaceRoot: string): Promise<DiceStats | null> {
  try {
    const text = await fs.readFile(path.join(workspaceRoot, POOL_PATH), 'utf8')
    return parsePool(text)
  } catch {
    return null
  }
}

export function generatePool(workspaceRoot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const toolsDir = path.join(workspaceRoot, 'tools')
    execFile('python', ['dice_pool.py', '-o'], { cwd: toolsDir }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message))
      resolve(stdout || 'done')
    })
  })
}

export function attachDiceRoutes(
  workspaceRoot: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  route: string,
): boolean {
  const panel = url.searchParams.get('panel') || ''

  // GET /api/dice/stats  (any panel)
  if (req.method === 'GET' && route === '/dice/stats') {
    readDiceStats(workspaceRoot).then((stats) => {
      sendJSON(res, 200, { stats })
    }).catch((e) => {
      sendJSON(res, 500, { error: e?.message || 'internal' })
    })
    return true
  }

  // POST /api/dice/generate  (DM only)
  if (req.method === 'POST' && route === '/dice/generate') {
    if (panel !== 'dm') {
      return sendJSON(res, 403, { error: 'DM only' }), true
    }
    generatePool(workspaceRoot).then((msg) => {
      readDiceStats(workspaceRoot).then((stats) => {
        sendJSON(res, 200, { message: msg, stats })
      }).catch(() => {
        sendJSON(res, 200, { message: msg })
      })
    }).catch((e) => {
      sendJSON(res, 500, { error: e?.message || 'internal' })
    })
    return true
  }

  return false
}
