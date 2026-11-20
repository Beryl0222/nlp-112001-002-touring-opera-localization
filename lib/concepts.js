// 概念锚点匹配：把中英文本里的说法映射到 CONCEPTS 中的类别。

import { CONCEPTS } from './lexicon.js';

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ZH_PATTERNS = CONCEPTS.map(concept => {
  const pattern = concept.termPattern ??
    new RegExp(concept.terms.map(term => escape(term)).join('|'), 'u');
  return { concept, pattern, source: pattern.source };
});

// 英文按较长说法优先匹配，避免 “horse” 抢先命中 “horsewhip”。
const EN_CUES = CONCEPTS
  .flatMap(concept => concept.english.map(entry => ({ concept, ...entry })))
  .sort((a, b) => b.cue.length - a.cue.length);

const EN_PATTERNS = EN_CUES.map(entry => ({
  ...entry,
  pattern: new RegExp(`(?<![a-z])${escape(entry.cue)}(?![a-z])`, 'iu')
}));

function pushMatches(text, patterns, output) {
  for (const item of patterns) {
    const regex = new RegExp(item.pattern.source, item.pattern.flags.includes('g')
      ? item.pattern.flags
      : `${item.pattern.flags}g`);
    for (const match of text.matchAll(regex)) {
      output.push({
        conceptId: item.concept.id,
        label: item.concept.label,
        class: item.class ?? null,
        cue: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }
  return output;
}

/** 中文命中的概念（去重，保留首次出现位置）。 */
export function conceptMatchesZh(text) {
  const raw = pushMatches(text, ZH_PATTERNS, []);
  return dedupe(raw);
}

/** 英文命中的概念，class 来自词表。 */
export function conceptMatchesEn(text) {
  const raw = pushMatches(text, EN_PATTERNS, []);
  return dedupe(raw);
}

function dedupe(matches) {
  const seen = new Map();
  for (const match of matches.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const key = `${match.conceptId}:${match.start}:${match.end}`;
    if (!seen.has(key)) seen.set(key, match);
  }
  // 同一概念里被更长说法覆盖的短说法不再重复计一次
  // （如 “把鞭借给你”里的“借”）。不同概念的重叠保留，
  // 因为一个短语可能同时点出道具和动作。
  const accepted = [];
  for (const match of [...seen.values()].sort((a, b) => b.end - b.start - (a.end - a.start))) {
    const absorbed = accepted.some(other =>
      other.conceptId === match.conceptId &&
      other.start <= match.start && other.end >= match.end
    );
    if (!absorbed) accepted.push(match);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/** 中文片段里提到的概念，用于给英文改稿找原始出处。 */
export function conceptsInZh(text) {
  return conceptMatchesZh(text);
}

export function conceptsInEn(text) {
  return conceptMatchesEn(text);
}
