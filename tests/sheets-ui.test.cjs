const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const tick = () => new Promise(resolve => setImmediate(resolve));
test('late error refresh cannot overwrite newer synced UI', async () => {
  const label = { textContent: '' };
  const reads = [];
  let changed;
  const context = vm.createContext({
    document: { getElementById: id => id === 'sheetsStatus' ? label : null },
    window: { addEventListener() {} },
    chrome: {
      storage: {
        local: { get: () => new Promise(resolve => reads.push(resolve)) },
        onChanged: { addListener: fn => { changed = fn; } }
      },
      runtime: { sendMessage: async () => ({ ok: true }) }
    },
    BookmarkDB: { snapshot: async () => ({ pending: [] }) }
  });
  vm.runInContext(fs.readFileSync('sheets-ui.js', 'utf8'), context);
  changed({ sheetsStatus: {} }, 'local');
  reads[1]({ sheetsConfig: { enabled: true }, sheetsStatus: { state: 'synced', lastSync: 1000 } });
  await tick();
  const success = label.textContent;
  assert.match(success, /Đã đồng bộ/);
  reads[0]({ sheetsConfig: { enabled: true }, sheetsStatus: { state: 'error', message: 'old failure' } });
  await tick();
  assert.equal(label.textContent, success);
});
