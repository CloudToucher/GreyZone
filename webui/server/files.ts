/**
 * Vite middleware: file-tree + read/write file API for the Gray Zone workspace.
 *
 * - All paths are workspace-relative (POSIX-style with forward slashes).
 * - Server resolves them against WORKSPACE_ROOT and refuses any path that
 *   escapes the root or is not whitelisted for the requested panel.
 *
 * Endpoints:
 *   GET  /api/health                       -> { ok, root }
 *   GET  /api/tree?panel=dm|player         -> filtered directory tree (md only)
 *   GET  /api/file?panel=...&path=<rel>    -> { path, content, frontmatter, size, mtime }
 *   PUT  /api/file?panel=...&path=<rel>    -> body { content }; writes file (creates dirs)
 *   POST /api/round                        -> body { action, character?, prompt? }
 *                                              starts an opencode round; returns { roundId }
 *   GET  /api/round/stream?id=<roundId>    -> SSE stream of round events
 */
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import yaml from 'js-yaml'
import { startRound, attachStream, type RoundRequest } from './opencode'
import { attachDiceRoutes } from './dice'

export type Panel = 'dm' | 'player'

export interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: TreeNode[]
}

// ---------- Visibility rules ----------
const VISIBILITY: Record<Panel, { allow: string[]; deny: string[] }> = {
  dm: {
    allow: [''],
    deny: ['webui', 'node_modules', '.git'],
  },
  player: {
    allow: [
      'README.md',
      '开始游戏.md',
      'playground.md',
      'rules',
      'characters/templates',
      'characters/active',
      'assets/items',
      'logs',
    ],
    deny: [
      'dm_guide',
      'scenes',
      'story',
      'assets/enemies',
      'assets/npcs',
      'tools',
      'webui',
      'node_modules',
      '.git',
    ],
  },
}

// ---------- Write whitelist (per panel) ----------
// Player can only write a small set of files. DM can write anything not denied above.
const WRITE_ALLOW: Record<Panel, (rel: string) => boolean> = {
  dm: (rel) => isVisible(rel, 'dm'),
  player: (rel) =>
    rel === 'playground.md' ||
    rel.startsWith('characters/active/') ||
    rel.startsWith('logs/'),
}

const HIDDEN_NAMES = new Set(['.git', '.gitkeep', 'node_modules', '.DS_Store', 'Thumbs.db'])

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

function isVisible(relPosix: string, panel: Panel): boolean {
  const rules = VISIBILITY[panel]
  for (const d of rules.deny) {
    if (d === '' || relPosix === d || relPosix.startsWith(d + '/')) return false
  }
  for (const a of rules.allow) {
    if (a === '') return true
    if (relPosix === a) return true
    if (relPosix.startsWith(a + '/')) return true
    if (a.startsWith(relPosix + '/')) return true
  }
  return false
}

function resolveSafe(root: string, rel: string): string | null {
  if (path.isAbsolute(rel)) return null
  const cleaned = rel.replace(/\\/g, '/').replace(/\/+$/g, '')
  if (cleaned.split('/').some((seg) => seg === '..')) return null
  const abs = path.resolve(root, cleaned)
  const rootResolved = path.resolve(root)
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) return null
  return abs
}

async function buildTree(root: string, panel: Panel): Promise<TreeNode> {
  async function walk(absDir: string, relPosix: string): Promise<TreeNode> {
    const entries = await fs.readdir(absDir, { withFileTypes: true })
    const children: TreeNode[] = []
    for (const ent of entries) {
      if (HIDDEN_NAMES.has(ent.name)) continue
      const childRel = relPosix ? `${relPosix}/${ent.name}` : ent.name
      if (!isVisible(childRel, panel)) continue
      const childAbs = path.join(absDir, ent.name)
      if (ent.isDirectory()) {
        const sub = await walk(childAbs, childRel)
        if (sub.children && sub.children.length > 0) children.push(sub)
      } else if (ent.isFile()) {
        if (!ent.name.toLowerCase().endsWith('.md')) continue
        children.push({ name: ent.name, path: childRel, type: 'file' })
      }
    }
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
    return {
      name: relPosix === '' ? 'Gray Zone' : path.basename(absDir),
      path: relPosix,
      type: 'dir',
      children,
    }
  }
  return walk(root, '')
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
    /* ignore */
  }
  return { frontmatter: null, body: text }
}

function sendJSON(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

function parsePanel(url: URL): Panel {
  const v = url.searchParams.get('panel')
  return v === 'dm' ? 'dm' : 'player'
}

async function readJsonBody(req: IncomingMessage, max = 4 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > max) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

export function filesMiddleware(workspaceRoot: string) {
  const root = path.resolve(workspaceRoot)
  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: any) => void,
  ) {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const route = url.pathname

      // ---------- Dice routes (stats=any, generate=DM only) ----------
      if (attachDiceRoutes(root, req, res, url, route)) return

      // ---------- GET /health ----------
      if (req.method === 'GET' && route === '/health') {
        return sendJSON(res, 200, { ok: true, root })
      }

      // ---------- GET /tree ----------
      if (req.method === 'GET' && route === '/tree') {
        const panel = parsePanel(url)
        const tree = await buildTree(root, panel)
        return sendJSON(res, 200, { panel, tree })
      }

      // ---------- GET /file ----------
      if (req.method === 'GET' && route === '/file') {
        const panel = parsePanel(url)
        const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '')
        if (!rel) return sendJSON(res, 400, { error: 'missing path' })
        if (!isVisible(rel, panel)) return sendJSON(res, 403, { error: 'forbidden' })
        const abs = resolveSafe(root, rel)
        if (!abs) return sendJSON(res, 400, { error: 'invalid path' })
        try {
          const stat = await fs.stat(abs)
          if (!stat.isFile()) return sendJSON(res, 400, { error: 'not a file' })
          if (stat.size > 4 * 1024 * 1024) return sendJSON(res, 413, { error: 'file too large' })
          const buf = await fs.readFile(abs, 'utf8')
          const { frontmatter, body } = splitFrontmatter(buf)
          return sendJSON(res, 200, {
            path: toPosix(rel),
            size: stat.size,
            mtime: stat.mtimeMs,
            frontmatter,
            content: body,
          })
        } catch (e: any) {
          if (e?.code === 'ENOENT') return sendJSON(res, 404, { error: 'not found' })
          throw e
        }
      }

      // ---------- PUT /file ----------
      if (req.method === 'PUT' && route === '/file') {
        const panel = parsePanel(url)
        const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '')
        if (!rel) return sendJSON(res, 400, { error: 'missing path' })
        if (!isVisible(rel, panel)) return sendJSON(res, 403, { error: 'forbidden' })
        if (!WRITE_ALLOW[panel](rel))
          return sendJSON(res, 403, { error: 'write not allowed for this panel' })
        if (!rel.toLowerCase().endsWith('.md'))
          return sendJSON(res, 400, { error: 'only .md files writable' })
        const abs = resolveSafe(root, rel)
        if (!abs) return sendJSON(res, 400, { error: 'invalid path' })

        let body: any
        try {
          body = await readJsonBody(req)
        } catch (e: any) {
          return sendJSON(res, 400, { error: e?.message || 'invalid body' })
        }
        if (typeof body?.content !== 'string') {
          return sendJSON(res, 400, { error: 'body.content must be string' })
        }
        if (body.content.length > 4 * 1024 * 1024) {
          return sendJSON(res, 413, { error: 'content too large' })
        }

        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, body.content, 'utf8')
        const stat = await fs.stat(abs)
        return sendJSON(res, 200, {
          path: toPosix(rel),
          size: stat.size,
          mtime: stat.mtimeMs,
        })
      }

      // ---------- POST /round  (start opencode round) ----------
      if (req.method === 'POST' && route === '/round') {
        let body: any
        try {
          body = await readJsonBody(req)
        } catch (e: any) {
          return sendJSON(res, 400, { error: e?.message || 'invalid body' })
        }
        const action: string = (body?.action || '').toString()
        const character: string | undefined = body?.character
        const customPrompt: string | undefined = body?.prompt
        if (!action.trim() && !customPrompt?.trim()) {
          return sendJSON(res, 400, { error: 'missing action or prompt' })
        }
        const r: RoundRequest = {
          workspaceRoot: root,
          action,
          character,
          customPrompt,
        }
        const { roundId } = startRound(r)
        return sendJSON(res, 200, { roundId })
      }

      // ---------- GET /round/stream  (SSE) ----------
      if (req.method === 'GET' && route === '/round/stream') {
        const id = url.searchParams.get('id') || ''
        if (!id) return sendJSON(res, 400, { error: 'missing id' })
        const ok = attachStream(id, res)
        if (!ok) return sendJSON(res, 404, { error: 'round not found' })
        return // attachStream owns the response from here
      }

      // ---------- GET /raw ----------
      if (req.method === 'GET' && route === '/raw') {
        const panel = parsePanel(url)
        const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '')
        if (!isVisible(rel, panel)) return sendJSON(res, 403, { error: 'forbidden' })
        const abs = resolveSafe(root, rel)
        if (!abs) return sendJSON(res, 400, { error: 'invalid path' })
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        createReadStream(abs).pipe(res)
        return
      }

      return next()
    } catch (err: any) {
      console.error('[gray-zone-api]', err)
      sendJSON(res, 500, { error: err?.message || 'internal error' })
    }
  }
}
