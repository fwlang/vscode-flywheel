const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseMessages, frame } = require('../extension.js');

test('frames and splits language server messages', () => {
  const a = frame({ jsonrpc: '2.0', id: 1, result: { text: 'é' } });
  const b = frame({ jsonrpc: '2.0', method: 'x', params: {} });
  const joined = Buffer.concat([a, b]);
  // Split mid-message: the first message parses, the rest waits for more bytes.
  const partial = parseMessages(joined.subarray(0, a.length + 5));
  assert.equal(partial.messages.length, 1);
  assert.equal(partial.messages[0].result.text, 'é');
  const all = parseMessages(Buffer.concat([partial.rest, joined.subarray(a.length + 5)]));
  assert.deepEqual(all.messages, [{ jsonrpc: '2.0', method: 'x', params: {} }]);
  assert.equal(all.rest.length, 0);
});
