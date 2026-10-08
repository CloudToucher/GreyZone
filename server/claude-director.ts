import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Store, Fault, uid } from './store.js';
import { Library } from './library.js';
import { context } from './projection.js';
import { descriptions, schemas } from './tools.js';
import type { Run } from '../shared/types.js';
import type { Director } from './dsh.js';

interface ClaudeConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export class ClaudeDirector implements Director {
  private client: Anthropic;
  private model: string;
  private running = new Map<string, Promise<void>>();
  private scheduled = new Map<string, Promise<void>>();
  private executing = new Map<string, string>();
  private executingGeneration = new Map<string, number>();
  private stages = new Map<string, string>();
  private sessionCache = new Map<string, { system: string; messages: Anthropic.MessageParam[] }>();
  private closed = false;

  constructor(
    public store: Store,
    public library: Library,
    config: ClaudeConfig,
    private changed: (id: string) => void = () => {},
  ) {
    // Use system config or provided config
    const apiKey = config.apiKey || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
    const baseURL = config.baseURL || process.env.ANTHROPIC_BASE_URL;

    if (!apiKey) throw new Error('ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN required');

    this.client = new Anthropic({ apiKey, baseURL });
    // Try to get model without [1M] suffix
    const sysModel = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || process.env.ANTHROPIC_MODEL || '';
    const cleanModel = sysModel.replace(/\[1M\]$/, '');
    this.model = config.model || cleanModel || 'claude-opus-4-8';
  }

  stage(room: string) {
    return this.stages.get(room) ?? '';
  }

  authorized(_room: string, _token: string) {
    return true; // Internal tool calls only
  }

  toolRun(room: string) {
    const id = this.executing.get(room);
    return id && this.store.run(id).metrics.resumptions === this.executingGeneration.get(room)
      ? id
      : undefined;
  }

  progress(room: string, stage: string) {
    this.stages.set(room, stage);
    this.changed(room);
  }

  async launch(runId: string) {
    if (this.closed) throw new Fault('主持服务正在关闭。', 503);
    const run = this.store.run(runId);
    const generation = run.metrics.resumptions;
    const ticket = `${runId}:${generation}`;
    const existing = this.scheduled.get(ticket);
    if (existing) return existing;
    const previous = this.running.get(run.roomId) ?? Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        const fresh = this.store.run(runId);
        if (!this.closed && fresh.status === 'running' && fresh.metrics.resumptions === generation)
          await this.execute(runId);
      });
    this.scheduled.set(ticket, task);
    this.running.set(run.roomId, task);
    try {
      await task;
    } finally {
      this.scheduled.delete(ticket);
      if (this.running.get(run.roomId) === task) this.running.delete(run.roomId);
    }
  }

  private async execute(runId: string) {
    let run = this.store.run(runId);
    const generation = run.metrics.resumptions;
    const started = Date.now();
    this.executing.set(run.roomId, runId);
    this.executingGeneration.set(run.roomId, generation);
    this.stages.set(run.roomId, run.kind === 'workshop' ? '主持人正在整理角色' : '主持人正在裁决');
    this.changed(run.roomId);

    try {
      const room = this.store.room(run.roomId);
      const system = this.buildSystem(room.id);
      const userPrompt = this.buildPrompt(room, run);

      // Restore or create conversation
      const cache = this.sessionCache.get(room.sessionId) ?? { system, messages: [] };
      cache.messages.push({ role: 'user', content: userPrompt });

      let finished = false;
      while (!finished) {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 8192,
          system,
          messages: cache.messages,
          tools: this.buildTools(),
        });

        run = this.store.run(runId);
        run.metrics.modelCalls++;
        run.metrics.inputTokens += response.usage.input_tokens;
        run.metrics.outputTokens += response.usage.output_tokens;
        const cacheCreation = (response.usage as any).cache_creation_input_tokens;
        const cacheRead = (response.usage as any).cache_read_input_tokens;
        if (cacheCreation) run.metrics.cacheWriteTokens = (run.metrics.cacheWriteTokens ?? 0) + cacheCreation;
        if (cacheRead) run.metrics.cacheReadTokens = (run.metrics.cacheReadTokens ?? 0) + cacheRead;
        this.store.saveRun(run);

        cache.messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'end_turn') {
          finished = true;
        } else if (response.stop_reason === 'tool_use') {
          const toolResults: Anthropic.MessageParam = {
            role: 'user',
            content: [],
          };

          for (const block of response.content) {
            if (block.type === 'tool_use') {
              this.progress(
                run.roomId,
                block.name.includes('context')
                  ? '主持人正在查阅资料'
                  : block.name === 'turn_commit'
                    ? '主持人正在整理结果'
                    : '主持人正在裁决',
              );

              try {
                const toolName = block.name.replace(/^mcp__table__/, '');
                if (!(toolName in schemas)) throw new Error(`Unknown tool: ${toolName}`);

                // Tool call is handled by GameTools through MCP-like interface
                const result = await this.callTool(toolName as keyof typeof schemas, block.input, runId);
                (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: JSON.stringify(result),
                });

                // Check if run was completed by tool
                run = this.store.run(runId);
                if (run.status !== 'running') {
                  finished = true;
                  break;
                }
              } catch (error) {
                (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  is_error: true,
                  content: JSON.stringify({
                    error: error instanceof Error ? error.message : '工具失败',
                    instruction: '根据错误修正调用。未提交的数据不会出现在玩家视图；已掷骰不能重掷。',
                  }),
                });
              }
            }
          }

          if (!finished) cache.messages.push(toolResults);
        } else {
          finished = true;
        }
      }

      // Save conversation for next turn
      this.sessionCache.set(room.sessionId, cache);

      run = this.store.run(runId);
      run.metrics.elapsedMs += Date.now() - started;
      if (run.status === 'running') {
        run.status = 'failed';
        run.error = '主持人尚未发布本轮结果。已保留检定和草稿，可继续裁决。';
      }
      this.store.saveRun(run);
    } catch (error) {
      run = this.store.run(runId);
      run.metrics.elapsedMs += Date.now() - started;
      if (run.status === 'running' && run.metrics.resumptions === generation) {
        run.status = 'failed';
        run.error = error instanceof Error ? error.message : '主持连接中断。已保留进度，可以继续本轮。';
      }
      this.store.saveRun(run);
      throw error;
    } finally {
      this.executing.delete(run.roomId);
      this.executingGeneration.delete(run.roomId);
      this.stages.delete(run.roomId);
      this.changed(run.roomId);
    }
  }

  private buildSystem(roomId: string): string {
    const charter = this.library.get('gm/charter.md').text;
    const rules = this.library.get('rules/quick.md').text;
    const room = this.store.room(roomId);
    const isAutoTest = room.sessionId?.includes('epic') || room.sessionId?.includes('test');

    const basePrompt = `${charter}\n\n${rules}\n\n你是这个TRPG团桌的主持人。工具名均带 mcp__table__ 前缀；使用提供的工具完成裁决。

**重要**：玩家已经提交了行动意图。你需要：
1. 理解情境和角色意图
2. 决定是否需要检定（使用 mcp__table__checks_resolve）
3. 描述结果和后果
4. 使用 mcp__table__turn_commit 发布叙述、状态变更和裁决结果

只有在遇到真正的新选择、重大未知风险时才使用 mcp__table__turn_ask 询问玩家。
大部分情况应该直接裁决并使用 turn_commit 发布。

新NPC若需检定，先用 mcp__table__state_apply 补充 stats/specialties。`;

    if (isAutoTest) {
      return `${basePrompt}

**自动化测试模式**：
这是一个自动化测试场景。**禁止使用 mcp__table__turn_ask**。
无论情况多么危险或复杂，都必须直接裁决所有行动并使用 turn_commit 发布结果。
即使角色面临生死抉择，也要基于他们的意图做出合理的裁决，不要询问玩家。
战斗、谈判、探索等所有场景都直接处理，给出明确的结果和后果。`;
    }

    return basePrompt;
  }

  private buildPrompt(room: ReturnType<typeof this.store.room>, run: Run): string {
    const instruction =
      run.kind === 'workshop'
        ? '与玩家讨论并更新本角色完整可采用的草案及初始物品。使用 turn_commit 发布；本轮只维护此角色。'
        : run.kind === 'discussion'
          ? '回答玩家的场外问题，不改变世界，使用 turn_commit 发布自然回复。'
          : '处理本批冻结行动，按情境决定顺序、检定和实际后果。读到骰子后继续主持。已提交的部分不要重复。通过 turn_commit 发布，或在真正的新选择处 turn_ask。';

    return JSON.stringify({
      instruction,
      context: context(room, run, this.store),
      documents: this.library.documents.map((d) => ({ id: d.id, title: d.title })),
    });
  }

  private buildTools(): Anthropic.Tool[] {
    return Object.entries(schemas).map(([name, schema]) => ({
      name: `mcp__table__${name}`,
      description: descriptions[name as keyof typeof schemas],
      input_schema: zodToJsonSchema(schema, name) as Anthropic.Tool.InputSchema,
    }));
  }

  private async callTool(name: keyof typeof schemas, input: unknown, runId: string): Promise<unknown> {
    // Import dynamically to avoid circular dependency
    const { GameTools } = await import('./tools.js');
    const tools = new GameTools(this.store, this.library, this.changed);
    return tools.call(name, input, runId);
  }

  stop(roomId: string) {
    // Claude API doesn't support cancellation, mark as stopped
    const runId = this.executing.get(roomId);
    if (runId) {
      const run = this.store.run(runId);
      run.status = 'failed';
      run.error = '房主暂停了裁决，可从已保存的进度继续。';
      this.store.saveRun(run);
    }
  }

  async compact(roomId: string): Promise<boolean> {
    if (this.running.has(roomId) || this.store.active(roomId))
      throw new Fault('本轮完成后才能整理长期记忆。', 409);

    // For Claude, we implement simple message truncation
    const room = this.store.room(roomId);
    const cache = this.sessionCache.get(room.sessionId);
    if (!cache || cache.messages.length < 10) return false;

    // Keep last 4 messages, summarize the rest
    const toSummarize = cache.messages.slice(0, -4);
    const summary = `[前面共 ${toSummarize.length} 轮对话已整理]\n\n主要内容：角色创建、行动裁决和世界状态更新。具体细节保存在数据库中。`;

    cache.messages = [
      { role: 'user', content: summary },
      { role: 'assistant', content: '明白，我会从权威数据继续主持。' },
      ...cache.messages.slice(-4),
    ];
    this.sessionCache.set(room.sessionId, cache);

    return true;
  }

  async close() {
    this.closed = true;
    await Promise.allSettled(this.running.values());
  }
}
