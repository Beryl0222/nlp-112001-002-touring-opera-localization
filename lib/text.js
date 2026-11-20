// 文本工具。start/end 均为 JavaScript 字符串下标（UTF-16 code unit），
// 可直接用于 text.slice(start, end)；字数统计另按 Unicode 码点计算。

const CJK_SENTENCE_END = new Set(['。', '！', '？', '；', '\n']);
const ASCII_SENTENCE_END = new Set(['!', '?', ';']);
const CLAUSE_END = new Set([...'，,、；;。！？!?\n']);
const ABBREVIATION = /(?:\b(?:Mr|Mrs|Ms|Dr|St|vs|etc|e\.g|i\.e))$/i;

function trimSpan(text, start, end) {
  let s = start;
  let e = end;
  while (s < e && /\s/u.test(text[s])) s += 1;
  while (e > s && /\s/u.test(text[e - 1])) e -= 1;
  return { start: s, end: e };
}

function pushSpan(text, start, end, spans) {
  const trimmed = trimSpan(text, start, end);
  if (trimmed.start < trimmed.end) {
    spans.push({ ...trimmed, text: text.slice(trimmed.start, trimmed.end) });
  }
}

/**
 * 按句末标点切分，返回带绝对下标的句子。
 * 英文句点只有后面是空白或文本末尾时才切分，并跳过常见缩写。
 */
export function splitSentences(text, baseOffset = 0) {
  const spans = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    let boundary = CJK_SENTENCE_END.has(char) || ASCII_SENTENCE_END.has(char);
    if (char === '.') {
      const before = text.slice(start, index);
      const after = text[index + 1];
      boundary = !ABBREVIATION.test(before) &&
        (after === undefined || /\s/u.test(after));
    }
    if (boundary) {
      pushSpan(text, start, index + 1, spans);
      start = index + 1;
    }
  }
  if (start < text.length) pushSpan(text, start, text.length, spans);
  return spans.map(span => ({
    ...span,
    start: span.start + baseOffset,
    end: span.end + baseOffset
  }));
}

/** 在句内按逗号、顿号等切成更小的范围，用于定位动作、唱词或编辑注释。 */
export function splitClauses(text, baseOffset = 0) {
  const spans = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (CLAUSE_END.has(text[index])) {
      pushSpan(text, start, index + 1, spans);
      start = index + 1;
    }
  }
  if (start < text.length) pushSpan(text, start, text.length, spans);
  return spans.map(span => ({
    ...span,
    start: span.start + baseOffset,
    end: span.end + baseOffset
  }));
}

export function codePointLength(text) {
  return [...text].length;
}

export function normalizeSpace(text) {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

/** 词条比较用：全半角归一、去首尾空白、英文小写。中文繁简不在此处转换。 */
export function normalizeTerm(text) {
  return normalizeSpace(text).toLowerCase();
}

export function parseList(text) {
  return normalizeSpace(text)
    .split(/[\s、,，;；]+/u)
    .map(item => item.trim())
    .filter(Boolean);
}
