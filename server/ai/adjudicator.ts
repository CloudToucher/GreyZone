import { z } from 'zod';
import {
  amendmentSchema,
  conversationSchema,
  planSchema,
  type Plan,
  type Conversation,
  type Amendment,
  type SessionState,
} from '../../shared/types.js';
import { amendSheet, directorContext, GameError, propose } from '../engine.js';
import { querySchema, queryWorld } from '../world.js';
const replySchema = z.union([
  z.object({ tool: z.literal('query'), args: querySchema }).strict(),
  z.object({ tool: z.literal('validate'), plan: planSchema }).strict(),
  z.object({ tool: z.literal('propose'), plan: planSchema }).strict(),
  z.object({ error: z.string().min(1).max(400) }).strict(),
  conversationSchema,
  amendmentSchema,
  planSchema,
]);
export async function adjudicate<T extends boolean = false>(
  request: (prompt: string, signal: AbortSignal) => Promise<unknown>,
  state: SessionState,
  actorId: string,
  intent: string,
  signal: AbortSignal,
  instruction: string,
  onProgress?: (stage: string) => void,
  allowReplies?: T,
): Promise<T extends true ? Plan | Conversation | Amendment : Plan> {
  const exchanges: unknown[] = [];
  for (let turn = 0; turn < 6; turn++) {
    if (signal.aborted) throw new GameError('评估已取消。', 409);
    let raw: unknown;
    try {
      raw = await request(
        JSON.stringify({
          instruction,
          context: directorContext(state, actorId),
          playerIntent: intent,
          toolHistory: exchanges,
          remainingCalls: 6 - turn,
        }),
        signal,
      );
    } catch (e) {
      if (
        e instanceof GameError &&
        e.statusCode === 502 &&
        e.message.includes('协议校验') &&
        turn < 2
      ) {
        exchanges.push({
          toolResult: { error: '上次响应不是单一合法JSON对象，请仅输出符合工具协议的JSON。' },
        });
        continue;
      }
      throw e;
    }
    const parsed = replySchema.safeParse(raw);
    if (!parsed.success) {
      exchanges.push({
        assistant: raw,
        toolResult: { error: '结构校验失败，修正后重试。', issues: parsed.error.flatten() },
      });
      continue;
    }
    const answer = parsed.data;
    if ('error' in answer) throw new GameError(answer.error);
    if ('tool' in answer && (answer.tool === 'reply' || answer.tool === 'amend')) {
      if (allowReplies) {
        try {
          if (answer.tool === 'amend') amendSheet(state, actorId, answer);
          return answer as T extends true ? Plan | Conversation | Amendment : Plan;
        } catch (error) {
          exchanges.push({
            assistant: answer,
            toolResult: { error: error instanceof Error ? error.message : '修订无效' },
          });
          continue;
        }
      }
      exchanges.push({
        assistant: answer,
        toolResult: { error: '本次请求需要行动裁定，请使用 propose；纯讨论不要结算。' },
      });
      continue;
    }
    if ('tool' in answer && answer.tool === 'query') {
      onProgress?.('主持人正在查阅人物、现场与过往记录');
      exchanges.push({ assistant: answer, toolResult: queryWorld(state, answer.args) });
      continue;
    }
    const plan = 'tool' in answer ? answer.plan : answer;
    try {
      const preview = propose(state, actorId, intent, plan);
      if ('tool' in answer && answer.tool === 'validate') {
        onProgress?.('主持人正在核对资源与行动条件');
        exchanges.push({
          assistant: answer,
          toolResult: {
            valid: true,
            chance: preview.chance,
            powerCost: preview.powerCost,
            instability: preview.instability,
            minutes: preview.plan.minutes,
          },
        });
        continue;
      }
      return plan as T extends true ? Plan | Conversation | Amendment : Plan;
    } catch (e) {
      onProgress?.('主持人正在修正裁定中的条件与代价');
      exchanges.push({
        assistant: answer,
        toolResult: {
          valid: false,
          error: e instanceof Error ? e.message : '方案未通过规则校验，请修正。',
        },
      });
    }
  }
  throw new GameError(
    '主持人在本次工具预算内未形成有效裁定。没有扣除资源，可缩小当前步骤后再试。',
    502,
  );
}
