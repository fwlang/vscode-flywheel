const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { Registry, parseRawGrammar } = require('vscode-textmate');
const { loadWASM, OnigScanner, OnigString } = require('vscode-oniguruma');

const root = path.resolve(__dirname, '..');
let grammar;
before(async () => {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: patterns => new OnigScanner(patterns),
      createOnigString: value => new OnigString(value),
    }),
    loadGrammar: async scope => {
      assert.equal(scope, 'source.flywheel');
      const filename = path.join(root, 'syntaxes/flywheel.tmLanguage.json');
      return parseRawGrammar(fs.readFileSync(filename, 'utf8'), filename);
    },
  });
  grammar = await registry.loadGrammar('source.flywheel');
});

function tokenize(source) {
  let stack;
  const lines = source.split('\n').map(line => {
    const result = grammar.tokenizeLine(line, stack);
    assert.equal(result.stoppedEarly, false, `Tokenization stopped: ${line}`);
    stack = result.ruleStack;
    return { text: line, tokens: result.tokens };
  });
  return { lines, stack };
}

function scopesAt(result, line, text, occurrence = 0) {
  const record = result.lines[line];
  let index = -1;
  for (let i = 0; i <= occurrence; i++) index = record.text.indexOf(text, index + 1);
  assert.notEqual(index, -1, `Missing ${JSON.stringify(text)} on line ${line}`);
  const token = record.tokens.find(token => token.startIndex <= index && index < token.endIndex);
  assert.ok(token, `Missing token at ${line}:${index}`);
  return token.scopes;
}

function has(result, line, text, scope, occurrence) {
  assert.ok(scopesAt(result, line, text, occurrence).includes(scope),
    `${text}: expected ${scope}, got ${scopesAt(result, line, text, occurrence).join(' ')}`);
}

function lacks(result, line, text, scope) {
  assert.ok(!scopesAt(result, line, text).some(value => value.startsWith(scope)),
    `${text}: unexpected ${scope}, got ${scopesAt(result, line, text).join(' ')}`);
}

test('declarations, imports, built-ins, calls, and errors', () => {
  const result = tokenize([
    'import os as system # import alias',
    'public function main returns void',
    '    var name = input("Name: ")',
    '    print system.command(["git", "--version"])',
    '    try',
    '        throw ProcessError("failed")',
    '    catch ProcessError error',
    '        print error.message',
    '    end',
    'end',
    'class Person',
    '    string name',
    'end',
    'component Card = <div>{attr inner}</div>',
  ].join('\n'));
  has(result, 0, 'import', 'keyword.control.import.flywheel');
  has(result, 0, 'system', 'entity.name.namespace.flywheel');
  has(result, 0, '#', 'comment.line.number-sign.flywheel');
  has(result, 1, 'public', 'storage.modifier.flywheel');
  has(result, 1, 'main', 'entity.name.function.flywheel');
  has(result, 1, 'void', 'support.type.flywheel');
  has(result, 2, 'input', 'support.function.builtin.flywheel');
  has(result, 3, 'command', 'entity.name.function.call.flywheel');
  has(result, 6, 'ProcessError', 'support.type.flywheel');
  has(result, 10, 'Person', 'entity.name.type.class.flywheel');
  has(result, 13, 'Card', 'entity.name.type.component.flywheel');
  has(result, 13, 'attr', 'variable.language.flywheel');
  assert.equal(result.stack.depth, 1);
});

test('ranges, arithmetic, literals, comparisons, and generic types remain code', () => {
  const result = tokenize([
    'var numbers = 1..3',
    'var other = -2..<10',
    'var ratio = 10 // 3 + 1.25e-3',
    'if a < b and n >= 0 then',
    '    print true or false',
    'end',
    'array<map<string, tuple<element?>>>[] values = []',
    'map<string, [int, string]> pairs = {}',
    'element? found = null',
    'var before = a <b',
    'print <p>next statement</p>',
  ].join('\n'));
  has(result, 0, '..', 'keyword.operator.range.flywheel');
  has(result, 0, '3', 'constant.numeric.flywheel');
  has(result, 1, '..<', 'keyword.operator.range.flywheel');
  has(result, 1, '10', 'constant.numeric.flywheel');
  has(result, 2, '//', 'keyword.operator.arithmetic.flywheel');
  lacks(result, 2, '//', 'comment');
  has(result, 2, '1.25e-3', 'constant.numeric.flywheel');
  has(result, 3, '<', 'keyword.operator.comparison.flywheel');
  has(result, 4, 'true', 'constant.language.flywheel');
  has(result, 6, 'element', 'support.type.flywheel');
  lacks(result, 6, 'element', 'meta.element');
  has(result, 7, 'string', 'support.type.flywheel');
  has(result, 8, 'null', 'constant.language.flywheel');
  lacks(result, 9, 'b', 'meta.element');
  has(result, 10, 'next statement', 'string.unquoted.markup.flywheel');
  assert.equal(result.stack.depth, 1);
});

test('nested elements, same-name tags, fragments, self-closing tags, and attributes', () => {
  const result = tokenize([
    'import html.*',
    'var page = <>',
    '  <div class="card" data-note="a > b">',
    '    <div><br /><widgets.Title title={string(42)}>Hello # not a comment &amp; {name}</widgets.Title></div>',
    '    <p>Sibling</p>',
    '  </div>',
    '  <input disabled={true} />',
    '</>',
    'print page',
  ].join('\n'));
  has(result, 2, 'class', 'entity.other.attribute-name.flywheel');
  has(result, 2, 'a > b', 'string.quoted.double.flywheel');
  has(result, 3, 'br', 'entity.name.tag.flywheel');
  has(result, 3, 'widgets.Title', 'entity.name.tag.flywheel');
  has(result, 3, '42', 'constant.numeric.flywheel');
  has(result, 3, '# not', 'string.unquoted.markup.flywheel');
  lacks(result, 3, '# not', 'comment');
  has(result, 3, '&amp;', 'constant.character.entity.flywheel');
  has(result, 3, 'name', 'meta.embedded.expression.flywheel');
  has(result, 4, 'Sibling', 'string.unquoted.markup.flywheel');
  has(result, 6, 'disabled', 'entity.other.attribute-name.flywheel');
  has(result, 6, 'true', 'constant.language.flywheel');
  has(result, 8, 'print', 'support.function.builtin.flywheel');
  lacks(result, 8, 'page', 'meta.element');
  lacks(result, 8, 'page', 'meta.fragment');
  assert.equal(result.stack.depth, 1);
});

test('interpolation balances maps and nested strings and treats doubled braces literally', () => {
  const result = tokenize([
    'print "{{literal}} {string({"values": [1, 2]})} {input("Prompt: ")} \\u{26} \\""',
    'print <p>{{print}} {string({"key": [<b>inner</b>]})}</p>',
    'print 42 # back in code',
  ].join('\n'));
  has(result, 0, '{{', 'constant.character.escape.brace.flywheel');
  lacks(result, 0, 'literal', 'meta.embedded');
  has(result, 0, 'values', 'string.quoted.double.flywheel');
  has(result, 0, '2', 'constant.numeric.flywheel');
  has(result, 0, 'input', 'support.function.builtin.flywheel');
  has(result, 0, 'Prompt:', 'string.quoted.double.flywheel');
  has(result, 0, '\\u{26}', 'constant.character.escape.flywheel');
  has(result, 1, '{{', 'constant.character.escape.brace.flywheel');
  has(result, 1, 'inner', 'string.unquoted.markup.flywheel');
  has(result, 2, '#', 'comment.line.number-sign.flywheel');
  lacks(result, 2, '42', 'string');
  assert.equal(result.stack.depth, 1);
});

test('multiline attribute interpolation and nested markup restore the surrounding state', () => {
  const result = tokenize([
    'var page = <section',
    '    title="Hello, {name}"',
    '    hidden={count > 5 and not visible}',
    '>',
    '    {render(<><p>{string({"n": 3})}</p><hr /></>)}',
    '</section>',
    'print "done"',
  ].join('\n'));
  has(result, 1, 'title', 'entity.other.attribute-name.flywheel');
  has(result, 2, '>', 'keyword.operator.comparison.flywheel');
  has(result, 2, 'not', 'keyword.operator.logical.flywheel');
  has(result, 4, 'render', 'support.function.builtin.flywheel');
  has(result, 4, 'hr', 'entity.name.tag.flywheel');
  lacks(result, 6, 'print', 'meta.element');
  assert.equal(result.stack.depth, 1);
});

test('manifest links only existing extension resources and associates both suffixes', () => {
  const manifest = require('../package.json');
  assert.deepEqual(manifest.contributes.languages[0].extensions, ['.fw', '.fly']);
  assert.equal(manifest.contributes.grammars[0].scopeName, 'source.flywheel');
  for (const language of manifest.contributes.languages) {
    assert.ok(fs.existsSync(path.join(root, language.configuration)));
  }
  for (const resource of [...manifest.contributes.grammars, ...manifest.contributes.snippets]) {
    assert.ok(fs.existsSync(path.join(root, resource.path)));
  }
});

test('editor configuration uses Flywheel comments and word-oriented block indentation', () => {
  const config = require('../language-configuration.json');
  assert.equal(config.comments.lineComment, '#');
  const increase = new RegExp(config.indentationRules.increaseIndentPattern);
  const decrease = new RegExp(config.indentationRules.decreaseIndentPattern);
  for (const line of ['function main returns void', 'private function f(int n) returns int',
    'class Person', 'if ready then', 'else if other then', 'else', 'for x in 1..3 do',
    'while true do', 'try', 'catch ProcessError error', 'finally']) {
    assert.ok(increase.test(line), `Should indent after: ${line}`);
  }
  for (const line of ['print "then"', '# if true then', 'var x = 3', 'end']) {
    assert.ok(!increase.test(line), `Should not indent after: ${line}`);
  }
  for (const line of ['end', 'else', 'catch Error error', 'finally']) {
    assert.ok(decrease.test(line), `Should dedent: ${line}`);
  }
  for (const line of ['print "end"', '# end', 'var end_value = 3']) {
    assert.ok(!decrease.test(line), `Should not dedent: ${line}`);
  }
});

test('all repository examples tokenize without leaking a string or markup context', () => {
  function examples(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? examples(filename) : /\.(fw|fly)$/.test(entry.name) ? [filename] : [];
    });
  }
  const filenames = examples(path.join(root, '../examples'));
  assert.ok(filenames.length > 0);
  for (const filename of filenames) {
    const result = tokenize(fs.readFileSync(filename, 'utf8'));
    assert.equal(result.stack.depth, 1, `Unclosed highlighting context in ${filename}`);
  }
});
