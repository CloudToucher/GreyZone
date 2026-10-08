import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { recordSchema, type World } from '../shared/types.js';
export interface Document {
  id: string;
  title: string;
  text: string;
}
export class Library {
  documents: Document[] = [];
  constructor(public root = resolve('content')) {
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (path.endsWith('.md')) {
          const text = readFileSync(path, 'utf8');
          this.documents.push({
            id: relative(root, path).replaceAll('\\', '/'),
            title: text.split('\n')[0].replace(/^#+\s*/, ''),
            text,
          });
        }
      }
    };
    visit(root);
  }
  seed(): World {
    const records = recordSchema
      .array()
      .parse(JSON.parse(readFileSync(join(this.root, 'seed.json'), 'utf8')));
    return { minute: 0, records: Object.fromEntries(records.map((r) => [r.id, r])) };
  }
  get(id: string): Document {
    const doc = this.documents.find((d) => d.id === id);
    if (!doc) throw new Error('资料不存在：' + id);
    return doc;
  }
  search(query: string, limit = 5) {
    const terms = query
      .toLowerCase()
      .split(/[\s,，、;；]+/u)
      .filter(Boolean);
    return this.documents
      .map((d) => ({
        d,
        score: terms.reduce(
          (n, t) =>
            n +
            (d.title.toLowerCase().includes(t) ? 4 : 0) +
            (d.text.toLowerCase().includes(t) ? 1 : 0),
          0,
        ),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ d }) => {
        const lines = d.text.split('\n');
        const indices = lines
          .map((l, i) => (terms.some((t) => l.toLowerCase().includes(t)) ? i : -1))
          .filter((i) => i >= 0);
        const selected = new Set<number>();
        indices.slice(0, 5).forEach((i) => {
          for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 3); j++)
            selected.add(j);
        });
        return {
          id: d.id,
          title: d.title,
          excerpt: [...selected]
            .sort((a, b) => a - b)
            .map((i) => lines[i])
            .join('\n')
            .slice(0, 2200),
        };
      });
  }
}
