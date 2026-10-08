import { locateDsh } from '../server/dsh.js';
import { Library } from '../server/library.js';
import { Store } from '../server/store.js';
import { validateWorld } from '../server/tools.js';
import { loadLocalEnv } from '../server/config.js';
loadLocalEnv();
const library = new Library();
validateWorld(library.seed(), []);
const store = new Store(':memory:');
store.close();
console.log(
  JSON.stringify(
    {
      node: process.version,
      dsh: locateDsh(),
      documents: library.documents.length,
      worldRecords: Object.keys(library.seed().records).length,
      sqlite: 'ok',
    },
    null,
    2,
  ),
);
