// Reads native event metadata and published game output, never reasoning blocks or credentials.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import type { Campaign, Run } from '../shared/types.js';

const directory = resolve(process.argv[2] ?? process.env.LIVE_DIRECTORY ?? '.data/verification');
const db = new DatabaseSync(join(directory, 'table.sqlite'), { readOnly: true });
const room = JSON.parse(
  String(db.prepare('SELECT data FROM campaigns LIMIT 1').get()?.data),
) as Campaign;
const runs = db
  .prepare('SELECT data FROM runs ORDER BY rowid')
  .all()
  .map((r) => JSON.parse(String(r.data)) as Run);
interface Stats {
  modelCalls: number;
  toolCalls: number;
  toolErrors: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  compactions: number;
  contextBytes: number;
  toolInputBytes: number;
  toolOutputBytes: number;
  started?: string;
  ended?: string;
}
const empty = (): Stats => ({
  modelCalls: 0,
  toolCalls: 0,
  toolErrors: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  compactions: 0,
  contextBytes: 0,
  toolInputBytes: 0,
  toolOutputBytes: 0,
});
const stats = new Map<string, Stats>();
const models = new Map<string, { provider: string; model: string; reasoningEffort?: string }>();
const compact = empty();
const errors: { runId: string; text: string }[] = [];
type Event = { type: string; time: string; data: Record<string, any> };
const files = (p: string): string[] =>
  readdirSync(p, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(p, e.name)) : [join(p, e.name)],
  );
let current = '';
for (const path of files(join(directory, 'dsh-sessions')).filter((p) =>
  p.endsWith('session.jsonl.zstd'),
)) {
  const buffer = readFileSync(path);
  let offset = 0;
  while (offset < buffer.length) {
    let frame;
    try {
      frame = zstdDecompressSync(buffer.subarray(offset), { info: true }) as unknown as {
        buffer: Buffer;
        engine: { bytesWritten: number };
      };
    } catch {
      break;
    }
    offset += frame.engine.bytesWritten;
    for (const line of frame.buffer.toString().trim().split('\n').filter(Boolean)) {
      const event = JSON.parse(line) as Event;
      if (event.type === 'request/header') {
        const c = event.data.header?.config;
        if (typeof c?.provider === 'string' && typeof c.model === 'string')
          models.set(c.provider + ':' + c.model, {
            provider: c.provider,
            model: c.model,
            ...(typeof c.reasoningEffort === 'string'
              ? { reasoningEffort: c.reasoningEffort }
              : {}),
          });
      }
      if (event.type === 'user/message')
        for (const block of event.data.content ?? [])
          if (block.type === 'text') {
            try {
              const input = JSON.parse(block.text);
              if (input.context?.run?.id) {
                current = input.context.run.id;
                if (!stats.has(current)) stats.set(current, empty());
                const s = stats.get(current)!;
                s.started ??= event.time;
                s.contextBytes += Buffer.byteLength(block.text);
              }
            } catch {
              /* Other native user events. */
            }
          }
      if (!current) continue;
      const s = event.type === 'compaction/summary' ? compact : stats.get(current)!;
      if (event.type === 'assistant/message' || event.type === 'compaction/summary') {
        s.modelCalls++;
        for (const k of [
          'inputTokens',
          'cacheReadTokens',
          'cacheWriteTokens',
          'outputTokens',
          'reasoningTokens',
        ] as const)
          s[k] += Number(event.data.usage?.[k] ?? 0);
        if (event.type === 'compaction/summary') s.compactions++;
        for (const block of event.data.message?.content ?? [])
          if (block.type === 'tool-call')
            s.toolInputBytes += Buffer.byteLength(
              JSON.stringify(block.arguments ?? block.input ?? {}),
            );
      }
      if (event.type === 'tool/result')
        for (const block of event.data.message?.content ?? [])
          if (block.type === 'tool-result') {
            s.toolCalls++;
            s.toolOutputBytes += Buffer.byteLength(JSON.stringify(block.content ?? []));
            if (block.isError) {
              s.toolErrors++;
              errors.push({
                runId: current,
                text: (block.content ?? [])
                  .filter((c: any) => c.type === 'text')
                  .map((c: any) => c.text)
                  .join('\n')
                  .slice(0, 1500),
              });
            }
          }
      if (event.type === 'turn/end') s.ended = event.time;
    }
  }
}
const out = resolve(directory, 'review');
mkdirSync(out, { recursive: true });
const summary = {
  models: [...models.values()],
  roomId: room.id,
  rounds: runs.filter((r) => r.kind === 'round' && r.status === 'completed').length,
  checkpoints: room.journal.length,
  compact,
  runs: runs.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    resumptions: r.metrics.resumptions,
    reportedElapsedMs: r.metrics.elapsedMs,
    publishedElapsedMs: Math.max(
      0,
      new Date(
        room.journal.filter((e) => e.runId === r.id).at(-1)?.createdAt ?? r.createdAt,
      ).getTime() - new Date(r.createdAt).getTime(),
    ),
    ...stats.get(r.id),
  })),
  errors,
};
writeFileSync(join(out, 'metrics.json'), JSON.stringify(summary, null, 2));
const table = [
  '| 轮次 | 状态 | 秒（发布/运行器） | 模型调用 | 工具调用/错误 | 未缓存输入 | 缓存读取 | 输出（含推理） |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
];
let round = 0;
const transcript: string[] = [
  '# 真实 dsh 跑团公开输出审阅',
  '',
  `战役 ${room.id}；只含已发布叙述、裁决及账目，不包含模型思考或连接凭证。`,
  '',
];
for (const run of runs) {
  const s = stats.get(run.id) ?? empty(),
    label = run.kind === 'round' ? String(++round) : run.kind;
  table.push(
    `| ${label} | ${run.status} | ${Math.round(summary.runs.find((r) => r.id === run.id)!.publishedElapsedMs / 1000)} / ${Math.round(run.metrics.elapsedMs / 1000)} | ${s.modelCalls} | ${s.toolCalls}/${s.toolErrors} | ${s.inputTokens} | ${s.cacheReadTokens} | ${s.outputTokens} |`,
  );
  transcript.push(`## ${label} · ${run.id}`, '', ...run.actions.map((a) => `玩家：${a.text}`), '');
  for (const entry of room.journal.filter((e) => e.runId === run.id)) {
    transcript.push(
      `游戏分钟：${entry.minute}`,
      '',
      ...entry.passages.map((p) => p.text),
      '',
      ...entry.changes.map((c) => `- ${c.name}：${c.summary}（${c.reason}）`),
      '',
    );
  }
}
writeFileSync(join(out, 'rounds.md'), table.join('\n') + '\n');
writeFileSync(join(out, 'transcript.md'), transcript.join('\n'));
db.close();
console.log(
  JSON.stringify({
    review: out,
    completedRounds: summary.rounds,
    compactions: compact.compactions,
    toolErrors: errors.length,
  }),
);
