import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, Check, Send, X } from 'lucide-react';
import {
  schoolNames,
  draftNotices,
  skillNames,
  statNames,
  type CharacterDraft,
  type PublicState,
} from '../shared/types';

export function Landing({
  enter,
  busy,
  error,
}: {
  enter: (concept: string, room?: string) => void;
  busy: boolean;
  error: string;
}) {
  const [concept, setConcept] = useState(() => localStorage.getItem('greyzone.concept') ?? '');
  const [join, setJoin] = useState(false),
    [room, setRoom] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    enter(concept, join ? room.toUpperCase() : undefined);
  }
  return (
    <main className="new-entry">
      <header className="entry-brand">
        <span className="brand-mark">灰</span>
        <span>
          灰区：撤离<small>新沪港 · 2037</small>
        </span>
        <span className="entry-edition">自由叙事 TRPG</span>
      </header>
      <div className="entry-content">
        <section className="entry-world">
          <span className="eyebrow">封锁后的第十年</span>
          <h1>
            你来灰区，
            <br />
            是为了什么？
          </h1>
          <p>
            2027 年，UEG
            的「湮灭」实验撕开了近海裂隙。新沪港被封锁，里面的人还在过日子。十年后，零号井周围的黑雾开始向外扩散。
          </p>
          <p>铁壁靠合同招人，守望者守着家园，有人在废厂里找生路，也有人只想把一个人带出去。</p>
          <p className="entry-invitation">
            你的来历和目的，由你提出。
            <br />
            从这一刻起，主持人就与你一起开局。
          </p>
          <details className="setting-brief">
            <summary>了解这个世界</summary>
            <p>
              现代枪械依然致命，药品与弹药都有来源。灰币在封锁区外几乎不值钱，晶体与旧技术吸引着不同势力。围栏镇、工业港、废弃城区、荒野和零号井之间，没有规定你必须走的路线。
            </p>
            <p>
              异能依赖灰区环境与结晶传导。五个体系允许不同应用：身体强化、元素共鸣、感知扩张、空间干涉、精神支配。强度、限制和代价在开局时谈清楚，往后也能探索新用法。
            </p>
          </details>
        </section>
        <section className="entry-conversation">
          <div className="gm-label">
            <span className="status-dot" /> 主持人
          </div>
          <h2>说说你想扮演的人。</h2>
          <p>
            一句想法就够，也可以贴上完整角色设定。身份、能力、装备、关系、想玩的内容和不想接受的代价，都可以谈。暂时没想好，我们就从讨论开始。
          </p>
          <form onSubmit={submit}>
            <label htmlFor="concept">你的角色设想</label>
            <textarea
              id="concept"
              autoFocus
              required
              maxLength={12000}
              rows={9}
              value={concept}
              onChange={(e) => {
                setConcept(e.target.value);
                localStorage.setItem('greyzone.concept', e.target.value);
              }}
              placeholder={
                '例如：我想演一名港口潜水员，回来找失踪的搭档。带自己修过的潜水装备，不想背债，也不想配步枪。\n\n我能通过接触金属辨别附近的震动，但不希望它变成全知感知。希望多一些调查、危险救援和与当地人打交道。具体限制可以一起谈。'
              }
            />
            {join && (
              <label>
                房间码
                <input
                  required
                  minLength={6}
                  maxLength={6}
                  value={room}
                  onChange={(e) => setRoom(e.target.value.toUpperCase())}
                  placeholder="同伴的六位房间码"
                />
              </label>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary entry-start" disabled={busy || !concept.trim()}>
              {busy ? '正在进入…' : join ? '和主持人商量入队角色' : '与主持人一起开局'}
              <ArrowRight size={17} />
            </button>
            <button type="button" className="text-button join-link" onClick={() => setJoin(!join)}>
              {join ? '改为开始新战役' : '已有同伴？加入他们的战役'}
            </button>
          </form>
          <small className="entry-note">讨论和档案自动保存 · 你确认后才进入场景</small>
        </section>
      </div>
      <footer className="entry-foot">玩家决定自己想做什么。主持人回应世界，记录保留结果。</footer>
    </main>
  );
}

const personalLabels: Record<string, string> = {
  identity: '身份',
  appearance: '外貌与气质',
  motives: '目标',
  relationships: '关系',
  preferences: '想玩的内容',
  boundaries: '不接受的内容',
  advantages: '优势',
  complications: '短板与代价',
  notes: '补充',
};
export function PersonalDetails({ personal }: { personal: CharacterDraft['personal'] }) {
  return (
    <div className="personal-details">
      {Object.entries(personal)
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <section key={k}>
            <h4>{personalLabels[k] ?? k}</h4>
            <p>{v}</p>
          </section>
        ))}
    </div>
  );
}
export function DraftSheet({ draft, location }: { draft: CharacterDraft; location: string }) {
  return (
    <div className="draft-sheet">
      <span className="eyebrow">角色草案 · 可继续商量</span>
      <h2>{draft.name}</h2>
      <p className="draft-identity">{draft.personal.identity}</p>
      {draftNotices(draft).length > 0 && (
        <section className="draft-notices">
          <h3>开局前可以再商量</h3>
          {draftNotices(draft).map((n) => (
            <p key={n}>{n}</p>
          ))}
        </section>
      )}
      <section>
        <h3>经历</h3>
        <p>{draft.background}</p>
      </section>
      <PersonalDetails personal={draft.personal} />
      <section>
        <h3>能力与专长</h3>
        <div className="attributes">
          {Object.entries(draft.stats).map(([k, v]) => (
            <div key={k}>
              <span>{statNames[k as keyof typeof statNames]}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
        <div className="training-list">
          {Object.entries(draft.training).map(([k, v]) => (
            <span key={k}>
              {skillNames[k as keyof typeof skillNames] ?? k} +{v}
            </span>
          ))}
        </div>
        {draft.expertise.map((e) => (
          <article key={e.name}>
            <b>{e.name}</b>
            <small>
              {' '}
              {statNames[e.attribute]} + 训练 {e.training}
            </small>
            <p>{e.scope}</p>
          </article>
        ))}
        {draft.abilities.map((a) => (
          <article className="ability-detail" key={a.id}>
            <b>{a.name}</b>
            <small>
              {schoolNames[a.school]} · 能耗 {a.cost} · 负荷 +{a.strain}
            </small>
            <p>{a.description}</p>
            <p>{a.applications}</p>
            <p>
              <strong>限制：</strong>
              {a.limits}
            </p>
            <p>
              <strong>代价：</strong>
              {a.consequences}
            </p>
          </article>
        ))}
        {!draft.abilities.length && <p className="muted">没有已觉醒的异能。</p>}
      </section>
      <section>
        <h3>带进灰区的东西</h3>
        {draft.inventory.map((i) => (
          <article className="draft-item" key={i.id}>
            <b>
              {i.name} <span>× {i.quantity}</span>
            </b>
            <p>{i.description}</p>
            <small>
              {i.weight} kg / 件{i.weapon ? ` · 弹仓 ${i.weapon.loaded}/${i.weapon.capacity}` : ''}
            </small>
          </article>
        ))}
        <p>
          现金 {draft.cash} 灰币 · 欠款 {draft.debt}
          {draft.debt > 0 ? `（${draft.debtTo}）` : ''}
        </p>
      </section>
      <section className="draft-rationale">
        <h3>这些条件怎么来的</h3>
        <p>{draft.rationale}</p>
      </section>
      <section className="draft-opening">
        <span className="eyebrow">准备从 {location} 开始</span>
        <h3>{draft.opening.title}</h3>
        <p>{draft.opening.text}</p>
        {draft.opening.facts.map((f, i) => (
          <p key={i} className="muted">
            {f}
          </p>
        ))}
      </section>
    </div>
  );
}
export function Workshop({
  state,
  busy,
  error,
  retry,
  send,
  begin,
  cancel,
  leave,
}: {
  state: PublicState;
  busy: boolean;
  error: string;
  retry: (() => void) | null;
  send: (message: string) => Promise<boolean>;
  begin: () => void;
  cancel: () => void;
  leave: () => void;
}) {
  const w = state.workshop!;
  const [text, setText] = useState(''),
    [showDraft, setShowDraft] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [w.messages.length, state.busy]);
  useEffect(() => {
    if (w.messages.at(-2)?.text === text) setText('');
  }, [w.version, text, w.messages]);
  const locked = busy || !!state.busy || !!retry;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await send(text)) setText('');
  }
  return (
    <main className="workshop">
      <header className="workshop-head">
        <div>
          <span className="eyebrow">灰区：撤离 / 共同开局</span>
          <h1>先把这个人谈清楚。</h1>
        </div>
        <div className="workshop-nav">
          <span>房间 {state.id}</span>
          {w.draft && (
            <button onClick={() => setShowDraft(true)}>
              <BookOpen size={15} />
              查看角色草案
            </button>
          )}
          <button className="icon" aria-label="返回战役入口" disabled={locked} onClick={leave}>
            <X size={19} />
          </button>
        </div>
      </header>
      <div className={`workshop-body ${w.draft ? 'has-draft' : ''}`}>
        <section className="workshop-talk">
          <div className="discussion" aria-live="polite">
            <article className="gm-message">
              <span>主持人</span>
              <p>
                我们从你的设想开始。你可以随时补充、反驳，或者要求另一种实现；草案里的每项条件都可以继续商量。
              </p>
            </article>
            {!w.messages.length && (
              <article className="player-message">
                <span>你</span>
                <p>{w.seed}</p>
              </article>
            )}
            {w.messages.map((m, i) => (
              <article key={i} className={m.role === 'player' ? 'player-message' : 'gm-message'}>
                <span>{m.role === 'player' ? '你' : '主持人'}</span>
                <p>{m.text}</p>
              </article>
            ))}
            {w.questions.length > 0 && (
              <div className="discussion-questions">
                <b>还想与你确认</b>
                {w.questions.map((q, i) => (
                  <p key={i}>{q}</p>
                ))}
              </div>
            )}
            {state.busy && (
              <div className="thinking">
                <span className="spinner" />
                {state.busy}
                <button onClick={cancel}>停止这次回复</button>
              </div>
            )}
            <div ref={end} />
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              {retry && (
                <button disabled={busy} onClick={retry}>
                  重试未确认请求
                </button>
              )}
            </div>
          )}
          <form className="workshop-compose" onSubmit={submit}>
            <label htmlFor="discussion">继续与主持人讨论</label>
            <textarea
              id="discussion"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              maxLength={12000}
              disabled={locked}
              placeholder="哪些符合你的想法，哪些要改？也可以直接贴一版自己的设定。"
            />
            <div>
              <span>修改会出现在右侧草案中</span>
              <button className="primary" disabled={locked || !text.trim()}>
                <Send size={15} />
                发送
              </button>
            </div>
          </form>
        </section>
        {w.draft && (
          <aside className={`workshop-draft ${showDraft ? 'draft-visible' : ''}`}>
            <button
              className="draft-close icon"
              aria-label="关闭角色草案"
              onClick={() => setShowDraft(false)}
            >
              <X size={20} />
            </button>
            <DraftSheet
              draft={w.draft}
              location={
                state.locations.find((l) => l.id === w.draft!.location)?.name ?? w.draft.location
              }
            />
            <div className="adopt-draft">
              <p>采用这一版身份、装备和开场。你仍可以在游戏中和主持人讨论。</p>
              <button
                className="primary"
                disabled={locked || text.trim().length > 0}
                onClick={begin}
              >
                <Check size={16} />
                就以这个角色开始
              </button>
              {text.trim() && <small>先发送正在编辑的想法，让主持人更新草案。</small>}
            </div>
          </aside>
        )}
      </div>
      {!w.messages.length && !locked && !error && (
        <button className="primary" onClick={() => void send(w.seed)}>
          请主持人回应这个设想
        </button>
      )}
    </main>
  );
}
