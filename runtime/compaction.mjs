import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const pkg = (name) => pathToFileURL(join(process.env.GZ_DSH_PACKAGES, name, 'lib/index.js')).href;
const { BasicCompactionEngine } = await import(pkg('dsh-compaction-basic'));
const { BlockAssembler, createUserMessage } = await import(pkg('dsh-llm'));
const instruction =
  '请把以上跑团记录压缩成中文主持交接备忘，只输出备忘。保留：当前世界时刻与各队位置；人物身份、目标、关系与各自已知信息；关键已发生事实与来源；未兑现约定、威胁、期限及开放线索；新裁定的适用条件；未完成行动、玩家授权边界及等待回答的问题；本轮已经发生的骰子ID和结果。区分秘密与公开事实。合并旧摘要，删除已失效事项。不复制整张角色卡和历史账目，最新权威状态会重新注入。不要执行工具，不使用编程任务的摘要结构。';
export default class GmCompaction extends BasicCompactionEngine {
  async summarize(input, agent, signal) {
    const target = agent.session.requestHeader()?.config ?? agent.options;
    const assembler = new BlockAssembler();
    const options = {
      provider: target.provider,
      model: target.model,
      messages: [
        ...input.messages,
        createUserMessage({
          content: [{ type: 'text', text: instruction }],
          source: { kind: 'plugin', plugin: 'greyzone-compaction' },
        }),
      ],
      system: input.system,
      tools: input.tools ? [...input.tools] : undefined,
      maxTokens: 4096,
      sessionId: agent.session.id,
      purpose: 'compaction',
      signal,
    };
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk);
    if (['error', 'aborted'].includes(assembler.finish?.kind))
      throw new Error('GM summary interrupted');
    const rawOutput = assembler.blocks(),
      summary = rawOutput.filter((b) => b.type === 'text' && b.text.trim());
    if (!summary.length) throw new Error('GM summary is empty');
    return {
      summary,
      rawOutput,
      llmStreamCall: true,
      provider: target.provider,
      model: target.model,
      maxTokens: 4096,
      ...(assembler.usage ? { usage: assembler.usage } : {}),
    };
  }
}
