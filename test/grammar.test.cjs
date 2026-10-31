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

test('void elements need no closing tag, inline, nested, or across lines', () => {
  const result = tokenize([
    'import html.*',
    'var page = <div><img src="a.png" alt=logo><br><span>After</span></div>',
    'var field = <input type="text" disabled>',
    'var tall = <form>',
    '  <img',
    '    src={url}',
    '  >',
    '  <p>Below<hr></p>',
    '</form>',
    'var image =',
    '<meta',
    '  charset="utf-8">',
    'var brand = <brand>Not void</brand>',
    'print page',
  ].join('\n'));
  has(result, 1, 'img', 'entity.name.tag.flywheel');
  has(result, 1, 'logo', 'string.unquoted.attribute-value.flywheel');
  has(result, 1, 'br', 'entity.name.tag.flywheel');
  has(result, 1, 'After', 'string.unquoted.markup.flywheel');
  has(result, 2, 'disabled', 'entity.other.attribute-name.flywheel');
  lacks(result, 3, 'var', 'meta.element');
  has(result, 5, 'url', 'meta.embedded.expression.flywheel');
  has(result, 7, 'Below', 'string.unquoted.markup.flywheel');
  has(result, 7, 'hr', 'entity.name.tag.flywheel');
  lacks(result, 9, 'var', 'meta.element');
  has(result, 11, 'charset', 'entity.other.attribute-name.flywheel');
  has(result, 12, 'brand', 'entity.name.tag.flywheel', 1);
  has(result, 12, 'Not void', 'string.unquoted.markup.flywheel');
  has(result, 13, 'print', 'support.function.builtin.flywheel');
  lacks(result, 13, 'page', 'meta.element');
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

test('attribute names are never keywords, including valueless, single-quoted, and unquoted forms', () => {
  const result = tokenize([
    'var a = <h1 class="title">Hi</h1>',
    'var b = <input disabled class="x" />',
    "var c = <p class=big id='n {n}'>x</p>",
    'if a <b or c == d then',
    'end',
  ].join('\n'));
  has(result, 0, 'class', 'entity.other.attribute-name.flywheel');
  lacks(result, 0, 'class', 'storage');
  has(result, 1, 'disabled', 'entity.other.attribute-name.flywheel');
  has(result, 1, 'class', 'entity.other.attribute-name.flywheel');
  has(result, 2, 'big', 'string.unquoted.attribute-value.flywheel');
  has(result, 2, 'n {', 'string.quoted.single.flywheel');
  has(result, 2, 'n}', 'meta.embedded.expression.flywheel');
  lacks(result, 3, 'b', 'meta.element');
  assert.equal(result.stack.depth, 1);
});

test('markup uses HTML comments and never # comments', () => {
  const result = tokenize([
    'var a = <div>one <!-- note {x} --> two # not a comment</div>',
    'var b = <ul>',
    '    <!-- spans',
    '        lines -->',
    '    <li class="#{id}">{count # still code}</li>',
    '    <li>{f({"k": [1, 2]}) # x}</li>',
    '</ul>',
    'print a # trailing',
  ].join('\n'));
  has(result, 0, 'note', 'comment.block.html.flywheel');
  has(result, 0, '<!--', 'punctuation.definition.comment.begin.flywheel');
  has(result, 0, '-->', 'punctuation.definition.comment.end.flywheel');
  lacks(result, 0, 'x', 'meta.interpolation');
  has(result, 0, 'two', 'string.unquoted.markup.flywheel');
  has(result, 0, '# not', 'string.unquoted.markup.flywheel');
  lacks(result, 0, '# not', 'comment');
  has(result, 2, 'spans', 'comment.block.html.flywheel');
  has(result, 3, 'lines', 'comment.block.html.flywheel');
  lacks(result, 4, '#{', 'comment');
  lacks(result, 4, '# still', 'comment');
  has(result, 4, '}</li>', 'punctuation.section.interpolation.end.flywheel');
  lacks(result, 5, '# x', 'comment');
  has(result, 5, '}</li>', 'punctuation.section.interpolation.end.flywheel');
  has(result, 6, 'ul', 'entity.name.tag.flywheel');
  has(result, 7, '#', 'comment.line.number-sign.flywheel');
  assert.equal(result.stack.depth, 1);
});

test('style contents highlight as CSS and script contents as JavaScript', () => {
  const result = tokenize([
    'element styles = <style>',
    '    /* layout */',
    '    body, .card > p:hover {{',
    '        font-family: "Arial", sans-serif;',
    '        background: #f0f0f0 !important;',
    '        width: calc(100% - {gap}px);',
    '    }}',
    '    @media (max-width: 600px) {{ #main {{ margin: 0; }} }}',
    '</style>',
    'var js = <script>',
    '    // note',
    '    function greet(name) {{ return document.title + `hi` + {count}; }}',
    '    const class_name = 0x1F;',
    '</script>',
    'print "done"',
  ].join('\n'));
  has(result, 1, 'layout', 'comment.block.css.flywheel');
  has(result, 2, 'body', 'entity.name.tag.css.flywheel');
  has(result, 2, 'card', 'entity.other.attribute-name.class.css.flywheel');
  has(result, 2, 'hover', 'entity.other.attribute-name.pseudo-class.css.flywheel');
  has(result, 2, '{{', 'punctuation.section.property-list.begin.css.flywheel');
  has(result, 3, 'font-family', 'support.type.property-name.css.flywheel');
  has(result, 3, 'Arial', 'string.quoted.double.css.flywheel');
  has(result, 3, 'sans-serif', 'support.constant.property-value.css.flywheel');
  has(result, 4, '#f0f0f0', 'constant.other.color.rgb-value.css.flywheel');
  has(result, 4, '!important', 'keyword.other.important.css.flywheel');
  has(result, 5, 'calc', 'support.function.css.flywheel');
  has(result, 5, '100', 'constant.numeric.css.flywheel');
  has(result, 5, 'gap', 'meta.embedded.expression.flywheel');
  has(result, 5, 'px', 'keyword.other.unit.css.flywheel');
  has(result, 7, '@media', 'keyword.control.at-rule.css.flywheel');
  has(result, 7, 'max-width', 'support.type.property-name.css.flywheel');
  has(result, 7, 'main', 'entity.other.attribute-name.id.css.flywheel');
  has(result, 7, 'margin', 'support.type.property-name.css.flywheel');
  has(result, 7, '600', 'meta.embedded.block.css.flywheel');
  has(result, 8, 'style', 'entity.name.tag.flywheel');
  has(result, 10, 'note', 'comment.line.double-slash.js.flywheel');
  has(result, 11, 'function', 'storage.type.function.js.flywheel');
  has(result, 11, 'greet', 'entity.name.function.js.flywheel');
  has(result, 11, 'return', 'keyword.control.js.flywheel');
  has(result, 11, 'title', 'variable.other.property.js.flywheel');
  has(result, 11, 'hi', 'string.template.js.flywheel');
  has(result, 11, 'count', 'meta.embedded.expression.flywheel');
  has(result, 12, 'const', 'storage.type.js.flywheel');
  has(result, 12, 'class_name', 'variable.other.readwrite.js.flywheel');
  has(result, 12, '0x1F', 'constant.numeric.js.flywheel');
  lacks(result, 14, 'print', 'meta.element');
  assert.equal(result.stack.depth, 1);
});

test('style and script use CSS/JavaScript comments and never # comments', () => {
  const result = tokenize([
    'var s = <style>',
    '    # not a comment',
    '    p {{ color: red; # nope /* yes */ }}',
    '</style>',
    'var j = <script>',
    '    # nope',
    '    let a = 1; // yes # x',
    '    /* block',
    '       spans */ a = b / c; #priv',
    '</script>',
    'print s # trailing',
  ].join('\n'));
  lacks(result, 1, '# not', 'comment');
  lacks(result, 1, 'comment', 'comment');
  lacks(result, 2, '# nope', 'comment');
  lacks(result, 2, 'nope', 'comment');
  has(result, 2, 'yes', 'comment.block.css.flywheel');
  has(result, 2, '}}', 'punctuation.section.property-list.end.css.flywheel');
  lacks(result, 5, 'nope', 'comment');
  has(result, 6, 'yes', 'comment.line.double-slash.js.flywheel');
  has(result, 7, 'block', 'comment.block.js.flywheel');
  has(result, 8, 'spans', 'comment.block.js.flywheel');
  lacks(result, 8, 'priv', 'comment');
  has(result, 10, '#', 'comment.line.number-sign.flywheel');
  assert.equal(result.stack.depth, 1);
});

test('braces beside whitespace are literal, so JavaScript and CSS blocks keep their comments', () => {
  const result = tokenize([
    'var j = <script>',
    '    function greet(name) {',
    '        // inside',
    '        if (name) { return {count}; } /* block */',
    '    }',
    '    // after',
    '</script>',
    'var s = <style>',
    '    p { color: {c}; /* note */ }',
    '</style>',
    'print "{ name } {name}" # done',
    'var t = <p>a { b } {c}</p>',
  ].join('\n'));
  has(result, 1, '{', 'punctuation.section.block.js.flywheel');
  has(result, 2, 'inside', 'comment.line.double-slash.js.flywheel');
  has(result, 3, 'count', 'meta.embedded.expression.flywheel');
  has(result, 3, '} /*', 'punctuation.section.block.js.flywheel');
  has(result, 3, 'block', 'comment.block.js.flywheel');
  has(result, 4, '}', 'punctuation.section.block.js.flywheel');
  has(result, 5, 'after', 'comment.line.double-slash.js.flywheel');
  has(result, 8, '{', 'punctuation.section.property-list.begin.css.flywheel');
  has(result, 8, 'c}', 'meta.embedded.expression.flywheel');
  has(result, 8, 'note', 'comment.block.css.flywheel');
  has(result, 8, '}', 'punctuation.section.property-list.end.css.flywheel', 1);
  lacks(result, 10, ' name }', 'meta.interpolation');
  has(result, 10, 'name}', 'meta.embedded.expression.flywheel');
  has(result, 10, '#', 'comment.line.number-sign.flywheel');
  lacks(result, 11, ' b ', 'meta.interpolation');
  has(result, 11, 'c}', 'meta.embedded.expression.flywheel');
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
