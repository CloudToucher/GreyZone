import { promises as fs } from 'node:fs'
import path from 'node:path'
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
    /* ignore */
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
    const stats = {
      level: frontmatter?.level as string | number | undefined,
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
    '# Gray Zone Character Forge Request',
    '',
    'You are the AI DM for a file-backed TRPG workspace.',
    'Create a new playable character for the current player, write it into the requested file, and keep the result fully compatible with markdown + YAML frontmatter.',
    '',
    '## Required write target',
    args.outputPath,
    '',
    '## Hard requirements',
    `- Write the file at \`${args.outputPath}\`.`,
    `- Set frontmatter \`controller: ${args.seatName}\`.`,
    '- Include frontmatter fields: name, controller, level, hp, sp, ap, attributes.',
    '- Use the existing Gray Zone character style and headings so the UI can extract summary, situation, and stats.',
    '- Keep the character playable, specific, and ready to enter the world immediately.',
    '',
    '## Player concept',
    args.concept?.trim() || '(not provided)',
    '',
    '## Identity / background',
    args.identity?.trim() || '(not provided)',
    '',
    '## Motivation / desired play direction',
    args.motivation?.trim() || '(not provided)',
    '',
    '## Desired starting strength',
    args.strength?.trim() || '(not provided)',
    '',
    '## Desired tone',
    args.storyTone?.trim() || '(not provided)',
    '',
    '## Signature wish',
    args.signatureWish?.trim() || '(not provided)',
    '',
    '## Acceptable weaknesses / costs',
    args.weaknesses?.trim() || '(not provided)',
    '',
    '## Boundaries',
    args.boundaries?.trim() || '(not provided)',
    '',
    '## Extra notes',
    args.extraNotes?.trim() || '(not provided)',
    '',
    '## Response format',
    'After writing the file, reply with markdown headings in this order:',
    '## Character Concept',
    '## Initial State',
    '## Starting Equipment',
    '## Strengths',
    '## Costs And Risks',
    '## Current Situation',
    '## Written File',
  ].join('\n')
}

export function createRoundPrompt(args: {
  packetPath: string
  resultPath: string
  sharedBoardPath: string
}) {
  return [
    '# Gray Zone Single-Room TRPG Round',
    '',
    'You are the AI DM operating inside a file-backed TRPG room.',
    '',
    '## Read first',
    '- rules/00_规则速查索引.md',
    '- dm_guide/DM核心手册.md',
    `- ${args.packetPath}`,
    '',
    '## Your job',
    '- Resolve the current round based on the packet and visible world state.',
    '- Update any affected character files when confirmed state changes occur.',
    `- Update ${args.sharedBoardPath} with the public-facing round summary and current public board state.`,
    `- Write the player-facing round result to ${args.resultPath}.`,
    '- Do not edit control or seat assignment files unless the packet explicitly asks for it.',
    '',
    '## Result file contract',
    'Write markdown headings in this order:',
    '## Scene Progression',
    '## Rulings',
    '## Confirmed Changes',
    '## New Information',
    '## Next Directions',
    '',
    'Keep the result readable for players and useful for later AI turns.',
  ].join('\n')
}
