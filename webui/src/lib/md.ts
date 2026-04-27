import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import taskLists from 'markdown-it-task-lists'
import hljs from 'highlight.js'

export interface TocItem {
  level: number
  text: string
  slug: string
}

let _md: MarkdownIt | null = null

function ensure(): MarkdownIt {
  if (_md) return _md
  const escapeHtml = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  const md: MarkdownIt = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight(str: string, lang: string): string {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${
            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
          }</code></pre>`
        } catch {
          /* ignore */
        }
      }
      return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`
    },
  })
  md.use(anchor, {
    permalink: anchor.permalink.linkInsideHeader({
      class: 'heading-anchor',
      symbol: '#',
      placement: 'after',
      ariaHidden: true,
    }),
    slugify: (s: string) =>
      s
        .toLowerCase()
        .trim()
        .replace(/[\s\u3000]+/g, '-')
        .replace(/[^\w\-\u4e00-\u9fa5]/g, ''),
  })
  md.use(taskLists)

  // Wrap every <table> with a scrollable container so wide tables don't squeeze text.
  const defaultTableOpen =
    md.renderer.rules.table_open ||
    function (tokens, idx, options, _env, self) {
      return self.renderToken(tokens, idx, options)
    }
  md.renderer.rules.table_open = function (tokens, idx, options, env, self) {
    return '<div class="md-table-wrap">' + defaultTableOpen(tokens, idx, options, env, self)
  }
  const defaultTableClose =
    md.renderer.rules.table_close ||
    function (tokens, idx, options, _env, self) {
      return self.renderToken(tokens, idx, options)
    }
  md.renderer.rules.table_close = function (tokens, idx, options, env, self) {
    return defaultTableClose(tokens, idx, options, env, self) + '</div>'
  }
  _md = md
  return md
}

export function renderMarkdown(src: string): { html: string; toc: TocItem[] } {
  const md = ensure()
  const env = {}
  const tokens = md.parse(src, env)
  const toc: TocItem[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'heading_open') {
      const level = parseInt(t.tag.slice(1), 10)
      const inline = tokens[i + 1]
      const text = inline?.children?.map((c) => c.content).join('') || ''
      const slug = (t.attrGet('id') as string) || ''
      if (level <= 4 && text) toc.push({ level, text, slug })
    }
  }
  const html = md.renderer.render(tokens, md.options, env)
  return { html, toc }
}
