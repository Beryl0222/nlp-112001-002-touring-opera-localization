// 判断同一术语在不同版本、场次下是否仍指向同一种解释。
//
// 解释的可迁移性只由“证据”决定：
// - 同一版本场记里出现该术语的段落；
// - 同一版本的词义条目，且 context 能锚定到场次。
// 删掉唯一证据段落后，其它版本或其它场次的解释不会自动接替。

import { conceptsInZh } from './concepts.js';
import { normalizeTerm } from './text.js';

export function stageRowsFor(stageDirections, term, edition) {
  const wanted = normalizeTerm(term);
  return stageDirections.filter(row =>
    row.edition === edition && normalizeTerm(row.text).includes(wanted)
  );
}

const CONCEPT_IDS = text =>
  new Set(conceptsInZh(text).map(match => match.conceptId));

/**
 * 词义条目能在哪些场次作证。
 * 只认直接关系，不做场景间的概念扩散：
 * - termSegments：同版本场记原文出现该术语（含“马鞭/鞭”这类同一概念的简称）；
 * - contextSegments：context 直接写出场次名，或与场次名表达同一概念。
 * 若 context 指向具体场次，就只用这些场次，避免释义蔓延到别的场次；
 * context 只是用法类型（如“表演动作”）时才退回术语出现的场次。
 */
export function glossaryAnchors(gloss, { stageDirections, editionSegments }) {
  const termConcepts = CONCEPT_IDS(gloss.term);
  const termSegments = new Set();
  for (const row of stageDirections) {
    if (row.edition !== gloss.edition) continue;
    if (!editionSegments.includes(row.segment)) continue;
    const text = normalizeTerm(row.text);
    const textConcepts = CONCEPT_IDS(row.text);
    const sameTerm = text.includes(normalizeTerm(gloss.term)) ||
      [...termConcepts].some(id => textConcepts.has(id));
    if (sameTerm && termConcepts.size) termSegments.add(row.segment);
  }

  const context = gloss.context.replace(/[“”「」]/gu, '').trim();
  const contextConcepts = CONCEPT_IDS(context);
  const contextSegments = new Set();
  for (const segment of editionSegments) {
    if (!context) continue;
    if (context === segment || context.includes(segment) || segment.includes(context)) {
      contextSegments.add(segment);
      continue;
    }
    const segmentConcepts = CONCEPT_IDS(segment);
    if ([...contextConcepts].some(id => segmentConcepts.has(id))) contextSegments.add(segment);
  }

  if (!contextSegments.size) return [...termSegments];
  const narrowed = [...contextSegments].filter(segment => termSegments.has(segment));
  return narrowed.length ? narrowed : [...contextSegments];
}

/**
 * 为一个术语在指定版本中列出解释候选。
 * 不同 context 的解释各自保留，不在此处替编辑选一个。
 */
export function termCandidates({
  term,
  edition,
  keptSegments,
  removedSegments = [],
  stageDirections,
  glossary,
  extraTerms = []
}) {
  const editionSegments = [...new Set([
    ...keptSegments,
    ...removedSegments,
    ...stageDirections.filter(row => row.edition === edition).map(row => row.segment)
  ])];
  const candidates = [];
  if (!edition) return candidates;

  const wanted = new Set([term, ...extraTerms].map(normalizeTerm));
  for (const gloss of glossary.filter(row => row.edition === edition)) {
    const gTerm = normalizeTerm(gloss.term);
    if (![...wanted].some(item => gTerm === item || item.includes(gTerm) || gTerm.includes(item))) {
      continue;
    }
    candidates.push({
      kind: 'glossary',
      sourceId: gloss.id,
      edition: gloss.edition,
      term: gloss.term,
      context: gloss.context,
      gloss: gloss.gloss,
      contextSegments: glossaryAnchors(gloss, {
        stageDirections,
        editionSegments
      }),
      segments: [],
      usable: false,
      reasons: []
    });
  }

  for (const row of stageRowsFor(stageDirections, term, edition)) {
    candidates.push({
      kind: 'stage-note',
      sourceId: row.id,
      edition: row.edition,
      term,
      role: row.role,
      context: row.segment,
      gloss: row.text,
      contextSegments: [row.segment],
      segments: [],
      usable: false,
      reasons: []
    });
  }

  const kept = new Set(keptSegments);
  const removed = new Set(removedSegments);
  for (const candidate of candidates) {
    const anchors = candidate.contextSegments;
    const inKept = anchors.filter(segment => kept.has(segment));
    const inRemoved = anchors.filter(segment => removed.has(segment));
    candidate.supportedBy = inKept;
    candidate.lostWith = inRemoved;
    // 词义条目的 context 若指向被删场次，或场记行本身被删，都失去依据。
    if (!anchors.length) {
      candidate.usable = false;
      candidate.reasons = ['context 无法锚定到任何一个场次，需编辑补充出处'];
    } else if (!inKept.length) {
      candidate.usable = false;
      candidate.reasons = [`依据只来自已删段落 ${inRemoved.join('、') || anchors.join('、')}`];
    } else {
      candidate.usable = true;
      candidate.reasons = [];
    }
  }
  return candidates;
}

/**
 * 删段后的证据盘点：keptSegments 是调整后的场次，removedSegments 是删掉的。
 * 同一术语只要还有一条可用候选，就仍可解释；但失去依据的候选必须一起报出。
 */
export function explanationEvidence({
  terms,
  edition,
  keptSegments,
  removedSegments = [],
  stageDirections,
  glossary
}) {
  return terms.map(term => {
    const candidates = termCandidates({
      term,
      edition,
      keptSegments,
      removedSegments,
      stageDirections,
      glossary
    });
    const usable = candidates.filter(candidate => candidate.usable);
    const lost = candidates.filter(candidate => !candidate.usable);
    return {
      term,
      candidates,
      usable,
      lost,
      stillExplained: usable.length > 0,
      // 多个 context 解释并存时保留全部，不替编辑裁决。
      ambiguous: new Set(usable.map(item => item.context)).size > 1
    };
  });
}
