import * as acorn from 'acorn';
import beautyLib from 'js-beautify/js/lib/beautify.js';
import postcss from 'postcss';
import { compile } from '@vue/compiler-dom/dist/compiler-dom.esm-browser.js';

const WS = /^[ \t\r\n\f]*$/;
const stripWhitespace = s => s.replace(/[ \t\r\n\f]/g, '');
const pad = n => ' '.repeat(Math.max(0, n));
const same = (a, b, message) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(message);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const rawTags = new Set(['script', 'style', 'pre', 'textarea', 'title', 'xmp']);

function interpolationEnd(s, start) {
  const tail = s.slice(start + 2);
  const tokenizer = acorn.tokenizer(tail, { ecmaVersion: 'latest' });
  let depth = 0;
  for (;;) {
    const t = tokenizer.getToken();
    const type = t.type.label;
    if (type === 'eof') throw new Error('Vue 表达式未闭合，保留原文件。');
    if (type === '}' && depth === 0 && tail.slice(t.start, t.start + 2) === '}}') return start + 2 + t.start + 2;
    if (['{', '${', '[', '('].includes(type)) depth++;
    if (['}', ']', ')'].includes(type)) depth--;
    assert(depth >= 0, '无法安全解析 Vue 表达式，保留原文件。');
  }
}

export function tokenizeHTML(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const start = i;
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      assert(end >= 0, 'HTML 注释未闭合，保留原文件。');
      i = end + 3;
      tokens.push({ kind: 'comment', raw: source.slice(start, i), start, end: i });
    } else if (source.startsWith('{{', i)) {
      i = interpolationEnd(source, i);
      tokens.push({ kind: 'text', raw: source.slice(start, i), start, end: i, interpolation: true });
    } else if (/^<\/?[a-zA-Z!]/.test(source.slice(i))) {
      let quote = null;
      let closed = false;
      for (i++; i < source.length; i++) {
        const c = source[i];
        if (quote) { if (c === quote) quote = null; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '>') { i++; closed = true; break; }
      }
      assert(closed, 'HTML 标签未闭合，保留原文件。');
      const raw = source.slice(start, i);
      const m = /^<(\/)?([\w:-]+)/.exec(raw);
      const name = m ? m[2].toLowerCase() : '!doctype';
      const token = { kind: 'tag', raw, name, closing: !!m?.[1], void: !m || voidTags.has(name) || /\/\s*>$/.test(raw), start, end: i };
      tokens.push(token);
      if (!token.closing && !token.void && rawTags.has(name)) {
        const re = new RegExp('</' + name + '\\s*>', 'ig');
        re.lastIndex = i;
        const end = re.exec(source);
        assert(end, `${name} 区域未闭合，保留原文件。`);
        tokens.push({ kind: 'raw', raw: source.slice(i, end.index), name, start: i, end: end.index, owner: token });
        i = end.index;
      }
    } else {
      i++;
      while (i < source.length && !source.startsWith('{{', i) && !/^<\/?[a-zA-Z!]/.test(source.slice(i))) i++;
      tokens.push({ kind: 'text', raw: source.slice(start, i), start, end: i });
    }
  }
  const stack = [];
  for (const t of tokens) {
    if (t.kind === 'tag' && t.closing) {
      const open = stack.pop();
      assert(open?.name === t.name, '标签层级不完整或采用省略闭合写法；保留原文件。');
      open.close = t;
      t.open = open;
    }
    t.depth = stack.length;
    t.ancestors = stack.slice();
    if (t.kind === 'tag' && !t.closing && !t.void) stack.push(t);
  }
  assert(stack.length === 0, '存在未闭合的 HTML 标签，保留原文件。');
  return tokens;
}

function cleanAST(v) {
  if (Array.isArray(v)) return v.map(cleanAST);
  if (v && typeof v === 'object') {
    const result = {};
    for (const k of Object.keys(v)) {
      if (!['start', 'end', 'loc', 'range'].includes(k)) result[k] = cleanAST(v[k]);
    }
    return result;
  }
  return typeof v === 'bigint' ? String(v) + 'n' : v;
}

function jsInfo(source, sourceType = 'script') {
  const comments = [], tokens = [];
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType, onComment: comments, onToken: tokens });
  return { ast: cleanAST(ast), tokens, comments };
}

function formatJS(source, indent, sourceType, eol) {
  const original = jsInfo(source, sourceType);
  let result = beautyLib.js_beautify(source, {
    indent_size: 2, indent_with_tabs: false, preserve_newlines: true,
    max_preserve_newlines: 2, end_with_newline: false, wrap_line_length: 0,
    unescape_strings: false, templating: ['none'], e4x: false,
    space_in_paren: false, space_in_empty_paren: false, eol
  });
  let parsed = jsInfo(result, sourceType);
  same(original.tokens.map(t => t.type.label), parsed.tokens.map(t => t.type.label), 'JS 词法单元变化');
  assert(original.comments.length === parsed.comments.length, 'JS 注释数量变化');
  const replacements = [];
  original.tokens.forEach((t, i) => {
    const n = parsed.tokens[i], raw = source.slice(t.start, t.end);
    assert(stripWhitespace(raw) === stripWhitespace(result.slice(n.start, n.end)), 'JS 非空白字符变化');
    if (raw !== result.slice(n.start, n.end)) replacements.push({ start: n.start, end: n.end, raw });
  });
  original.comments.forEach((t, i) => replacements.push({ start: parsed.comments[i].start, end: parsed.comments[i].end, raw: source.slice(t.start, t.end) }));
  replacements.sort((a, b) => b.start - a.start).forEach(r => { result = result.slice(0, r.start) + r.raw + result.slice(r.end); });
  parsed = jsInfo(result, sourceType);
  const protectedRanges = [...parsed.tokens, ...parsed.comments].filter(t => /[\r\n]/.test(result.slice(t.start, t.end)));
  const starts = [0];
  for (let i = 0; i < result.length; i++) if (result[i] === '\n') starts.push(i + 1);
  for (let i = starts.length - 1; i >= 0; i--) {
    const at = starts[i];
    if (!protectedRanges.some(t => t.start < at && at < t.end) && result[at] !== '\r' && result[at] !== '\n') result = result.slice(0, at) + pad(indent) + result.slice(at);
  }
  const final = jsInfo(result, sourceType);
  same(original.ast, final.ast, 'JS 语法树变化');
  same(original.tokens.map(t => source.slice(t.start, t.end)), final.tokens.map(t => result.slice(t.start, t.end)), 'JS 字符串或词法单元变化');
  same(original.comments.map(t => source.slice(t.start, t.end)), final.comments.map(t => result.slice(t.start, t.end)), 'JS 注释变化');
  assert(stripWhitespace(source) === stripWhitespace(result), 'JS 非空白字符变化');
  return eol + result + eol + pad(indent - 2);
}

function cssSignature(root) {
  const a = [];
  root.walk(n => a.push({ type: n.type, selector: n.selector, prop: n.prop, value: n.value, important: n.important, name: n.name, params: n.params, text: n.text }));
  return a;
}

function formatCSS(source, indent, eol) {
  const root = postcss.parse(source), before = cssSignature(root);
  root.walk(n => {
    let depth = 0;
    for (let p = n.parent; p && p.type !== 'root'; p = p.parent) depth++;
    const indentation = pad(indent + depth * 2);
    if (WS.test(n.raws.before || '')) n.raws.before = eol + indentation;
    const last = n.nodes?.[n.nodes.length - 1];
    const customTail = last?.type === 'decl' && last.prop.startsWith('--') && !n.raws.semicolon;
    if (n.nodes && !customTail && WS.test(n.raws.after || '')) n.raws.after = eol + indentation;
    if (n.type === 'rule' && WS.test(n.raws.between || '')) n.raws.between = ' ';
    if (n.type === 'decl' && /^[ \t\r\n\f:]*$/.test(n.raws.between || '')) n.raws.between = ': ';
  });
  root.raws.after = eol + pad(indent - 2);
  const result = root.toString();
  same(before, cssSignature(postcss.parse(result)), 'CSS 属性值、选择器或注释变化');
  same(source.match(/\/\*[\s\S]*?\*\//g) || [], result.match(/\/\*[\s\S]*?\*\//g) || [], 'CSS 注释变化');
  assert(stripWhitespace(source) === stripWhitespace(result), 'CSS 非空白字符变化');
  return result;
}

function attr(tag, name) {
  const re = new RegExp('(?:\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function vueRegions(source, tokens, notes, enabled) {
  if (!enabled || !/(?:\bcreateApp\s*\(|vue(?:@3|[.\/-]))/i.test(source)) return [];
  const scripts = tokens.filter(t => t.kind === 'raw' && t.name === 'script').map(t => t.raw).join('\n');
  if (/compilerOptions|\bdelimiters\b|whitespace\s*:\s*['"]preserve/.test(scripts)) {
    notes.push('检测到自定义 Vue 编译配置，保留模板原有排版。');
    return [];
  }
  const ids = new Set();
  for (const m of scripts.matchAll(/\.mount\s*\(\s*(['"])#([\w:-]+)\1\s*\)/g)) ids.add(m[2]);
  const regions = [];
  for (const t of tokens) {
    if (t.kind !== 'tag' || t.closing || !t.close) continue;
    const id = attr(t.raw, 'id');
    if (id && (ids.has(id) || (t.name === 'template' && /template\s*:\s*['"]#/.test(scripts)))) {
      // Each region is checked independently before whitespace can be rewritten.
      try {
        const original = source.slice(t.end, t.close.start);
        compileSignature(original);
        regions.push({ start: t.end, end: t.close.start, original });
      } catch { notes.push(`模板 ${id} 无法安全编译，保留该区域排版。`); }
    }
  }
  return regions;
}

function compileSignature(template) {
  const errors = [];
  const { code } = compile(template, { mode: 'function', comments: true, onError: e => errors.push(e.code) });
  assert(!errors.length, '模板包含编译错误');
  return jsInfo('function compiledTemplate(){' + code + '\n}').ast;
}

function regionSignatures(source, tokens, regions) {
  return regions.map(region => {
    const originalStart = tokens.find(t => t.kind === 'tag' && !t.closing && t.end === region.start);
    const identifier = attr(originalStart.raw, 'id');
    return { identifier, value: compileSignature(region.original) };
  });
}

function applyEdits(source, edits) {
  const sorted = edits.slice().sort((a, b) => b.start - a.start);
  let lastStart = source.length + 1, result = source;
  for (const e of sorted) {
    assert(e.end <= lastStart, '格式化区域发生重叠');
    result = result.slice(0, e.start) + e.value + result.slice(e.end);
    lastStart = e.start;
  }
  return result;
}

export function formatSource(source, { formatVue = true } = {}) {
  const notes = [], checks = [];
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  try {
    const tokens = tokenizeHTML(source);
    const regions = vueRegions(source, tokens, notes, formatVue);
    const signatures = regionSignatures(source, tokens, regions);
    const rawEdits = [], layoutEdits = [];
    let cssCount = 0, jsCount = 0;
    const insideVue = (start, end) => regions.some(r => r.start <= start && end <= r.end);
    const insidePreserved = token => token.ancestors.some(t => /(?:\s)v-pre(?:\s|>|=)/.test(t.raw) || ['svg', 'math', 'noscript'].includes(t.name) || /white-space\s*:/.test(t.raw));
    // Static body whitespace is preserved exactly: changing it can affect inline layout or white-space CSS.
    for (const token of tokens) {
      if (token.kind !== 'raw') continue;
      const indent = token.depth * 2;
      if (token.name === 'script' && token.raw.trim()) {
        const type = attr(token.owner.raw, 'type') || '';
        if (!type || /^(?:text\/javascript|application\/javascript|module)$/i.test(type)) {
          try { rawEdits.push({ start: token.start, end: token.end, value: formatJS(token.raw, indent, type === 'module' ? 'module' : 'script', eol) }); jsCount++; }
          catch { notes.push('一段 JavaScript 未通过语法或一致性检查，已保留原样。'); }
        }
      } else if (token.name === 'style') {
        try { rawEdits.push({ start: token.start, end: token.end, value: formatCSS(token.raw, indent, eol) }); cssCount++; }
        catch { notes.push('一段 CSS 未通过语法或一致性检查，已保留原样。'); }
      }
    }
    for (let i = 0; i < tokens.length; i++) {
      const current = tokens[i];
      if (!['tag', 'comment'].includes(current.kind) || insidePreserved(current)) continue;
      let prev = tokens[i - 1];
      if (!prev) continue;
      let gapStart = current.start, gap = '';
      if (prev.kind === 'text' && WS.test(prev.raw)) { gapStart = prev.start; gap = prev.raw; prev = tokens[i - 2]; }
      if (!prev || !['tag', 'comment'].includes(prev.kind) || insidePreserved(prev)) continue;
      if (current.kind === 'tag' && current.closing && prev.kind === 'tag' && !prev.closing && current.name === prev.name) continue;
      const inHead = current.ancestors.some(t => t.name === 'head') && !current.ancestors.some(t => ['title', 'template'].includes(t.name));
      if (!insideVue(gapStart, current.start) && !inHead) continue;
      if (gap && !/[\r\n]/.test(gap)) continue;
      const value = eol + pad(current.depth * 2);
      if (gap !== value) layoutEdits.push({ start: gapStart, end: current.start, value });
    }
    let result = applyEdits(source, [...rawEdits, ...layoutEdits]);
    let resultTokens = tokenizeHTML(result);
    try {
      for (const signature of signatures) {
        const open = resultTokens.find(t => t.kind === 'tag' && !t.closing && attr(t.raw, 'id') === signature.identifier);
        assert(open?.close, '模板区域变化');
        same(signature.value, compileSignature(result.slice(open.end, open.close.start)), '模板编译结果变化');
      }
    } catch {
      result = applyEdits(source, rawEdits);
      resultTokens = tokenizeHTML(result);
      notes.push('模板换行未通过编译一致性检查，模板排版已回退。');
    }
    assert(stripWhitespace(source) === stripWhitespace(result), '检测到非空白字符变化');
    const structure = ts => ts.filter(t => ['tag', 'comment'].includes(t.kind)).map(t => t.raw);
    same(structure(tokens), structure(resultTokens), '标签、属性或 HTML 注释变化');
    const content = ts => ts.filter(t => t.kind === 'text' && !WS.test(t.raw)).map(t => t.raw);
    same(content(tokens), content(resultTokens), '文字或 Vue 表达式变化');
    const protectedRaw = ts => ts.filter(t => t.kind === 'raw' && !['script', 'style'].includes(t.name)).map(t => t.raw);
    same(protectedRaw(tokens), protectedRaw(resultTokens), '空白敏感区域变化');
    // Preserve every static text token, including whitespace, outside checked Vue regions and head.
    const staticTexts = ts => ts.filter(t => t.kind === 'text' && !t.ancestors.some(a => a.name === 'head') && !t.ancestors.some(a => signatures.some(s => attr(a.raw, 'id') === s.identifier))).map(t => t.raw);
    same(staticTexts(tokens), staticTexts(resultTokens), '静态 HTML 文本节点变化');
    checks.push('非空白字符一致', '标签与属性原样保留', '文字、表达式与注释一致', '字符串与空白敏感区域保留');
    if (jsCount) checks.push('JavaScript 词法与语法树一致');
    if (cssCount) checks.push('CSS 属性值与选择器一致');
    if (signatures.length) checks.push('Vue 模板编译结果一致');
    if (!regions.length) notes.push('未识别到可验证的 Vue 挂载模板；静态 HTML 元素之间的空白已保留。');
    return { source: result, changed: result !== source, safe: true, notes: [...new Set(notes)], checks, jsCount, cssCount, vueCount: signatures.length, originalLines: source.split(/\r?\n/).length, formattedLines: result.split(/\r?\n/).length };
  } catch (error) {
    return { source, changed: false, safe: false, notes: [error.message || '无法安全处理，保留原文件。'], checks: [], jsCount: 0, cssCount: 0, vueCount: 0, originalLines: source.split(/\r?\n/).length, formattedLines: source.split(/\r?\n/).length };
  }
}

export function decodeFile(bytes) {
  let encoding = 'utf-8', bom = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bom = 3;
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; bom = 2; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; bom = 2; }
  if (encoding === 'utf-8' && bytes.includes(0)) throw new Error('此文件可能采用无 BOM 的 UTF-16 编码。请先另存为 UTF-8，再导入。');
  const source = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(bom));
  return { source, encoding, bom: bytes.slice(0, bom) };
}

export function encodeFile(source, { encoding, bom }) {
  let body;
  if (encoding === 'utf-8') body = new TextEncoder().encode(source);
  else {
    body = new Uint8Array(source.length * 2);
    const little = encoding === 'utf-16le';
    for (let i = 0; i < source.length; i++) {
      const c = source.charCodeAt(i);
      body[i * 2 + (little ? 0 : 1)] = c & 255;
      body[i * 2 + (little ? 1 : 0)] = c >> 8;
    }
  }
  const result = new Uint8Array(bom.length + body.length);
  result.set(bom); result.set(body, bom.length);
  return result;
}
