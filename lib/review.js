// 编校报告：把场记、词义、改稿和场次单放在一起核对。
//
// 设计原则：
// - 报告只给定位、依据和可选处理，不自动改稿；
// - 多个解释并存时全部保留，不替编辑裁决；
// - 每条引用都带记录号与字符范围，可回到原句核对；
// - 删段后重新计算节目单与证据，不沿用删前的依据。

import { readMaterials } from '../materials.js';
import { conceptsInEn, conceptsInZh } from './concepts.js';
import { explanationEvidence, glossaryAnchors } from './evidence.js';
import { CONCEPT_BY_ID, IDENTITY_CONCEPTS } from './lexicon.js';
import { profileFor } from './profiles.js';
import { buildPrograms, findPrograms } from './shows.js';
import { annotateAll } from './stage.js';
import { codePointLength, normalizeTerm, splitSentences } from './text.js';
import { editionOrder } from './timeline.js';

const FACT_TAGS = new Set(['dialogue', 'lyric', 'stage-action', 'role']);
const COMMENTARY_TAGS = new Set(['narration', 'editorial-note', 'note', 'glossary']);
const NEGATION = /空台|没有实物|无实物|不持|并无|不用实物/u;
const SYMBOLIC_GLOSS = /示意|虚拟|象征|程式/u;
const KIN_GLOSS = /同门|师兄|师门|排行|称谓/u;
const LEND_GLOSS = /借/u;
const WITHHOLDING_NOTE = /留到|下半场|先不|暂不|不要提前|别急着/u;

function unique(values) {
  return [...new Set(values.filter(value => value !== undefined && value !== null))];
}

function sourceKind(tags) {
  if (tags.some(tag => COMMENTARY_TAGS.has(tag))) return 'commentary';
  if (tags.some(tag => FACT_TAGS.has(tag))) return 'fact';
  return 'unclear';
}

function sourceRef(link) {
  return {
    kind: link.kind,
    sourceId: link.kind === 'glossary' ? link.glossaryId : link.stageId,
    edition: link.edition,
    segment: link.segment ?? null,
    segments: link.segments ?? (link.segment ? [link.segment] : []),
    role: link.role ?? null,
    term: link.term ?? null,
    context: link.context ?? null,
    gloss: link.gloss ?? null,
    start: link.start ?? null,
    end: link.end ?? null,
    text: link.text ?? null,
    tags: link.tags ?? [],
    sourceKind: sourceKind(link.tags ?? []),
    negated: Boolean(link.negated)
  };
}

// ---------------------------------------------------------------------------
// 场记索引与概念证据
// ---------------------------------------------------------------------------

/**
 * 场记片段索引。所有原文引用都从这里取，保证带记录号与字符范围。
 */
function buildStageIndex(stageDirections) {
  return annotateAll(stageDirections).map(annotation => ({
    ...annotation,
    fragments: annotation.fragments.map(fragment => ({
      ...fragment,
      concepts: conceptsInZh(fragment.text).map(match => match.conceptId)
    })),
    roleConcepts: conceptsInZh(annotation.row.role ?? '').map(match => match.conceptId)
  }));
}

function glossaryLink(gloss, { stageDirections, active, excluded }) {
  const anchors = glossaryAnchors(gloss, {
    stageDirections,
    editionSegments: editionOrder(active, gloss.edition, stageDirections,
      excluded[gloss.edition] ?? [])
  });
  return {
    kind: 'glossary',
    glossaryId: gloss.id,
    edition: gloss.edition,
    term: gloss.term,
    context: gloss.context,
    gloss: gloss.gloss,
    segments: anchors,
    segment: anchors[0] ?? null,
    text: `${gloss.term}：${gloss.gloss}`,
    tags: ['glossary']
  };
}

function glossaryLinksFor(conceptId, { glossary, stageDirections, active, excluded }) {
  const concept = CONCEPT_BY_ID.get(conceptId);
  const terms = new Set([concept?.label, ...(concept?.terms ?? [])]
    .filter(Boolean)
    .map(normalizeTerm));
  return glossary
    .filter(row => {
      // 只认该词本身指向同一概念；不让“马鞭”顺带成为“马”的依据。
      const term = normalizeTerm(row.term);
      if (terms.has(term)) return true;
      return conceptsInZh(row.term).some(match => match.conceptId === conceptId) &&
        [...terms].some(item => term.includes(item) && item.length > 1);
    })
    .map(row => glossaryLink(row, { stageDirections, active, excluded }));
}

function stageLinksFor(conceptId, { stageIndex }) {
  const links = [];
  for (const annotation of stageIndex) {
    const { row } = annotation;
    if (annotation.roleConcepts.includes(conceptId)) {
      links.push({
        kind: 'role',
        stageId: row.id,
        edition: row.edition,
        segment: row.segment,
        role: annotation.row.role,
        text: annotation.row.role,
        tags: ['role']
      });
    }
    for (const fragment of annotation.fragments) {
      if (!fragment.concepts.includes(conceptId)) continue;
      links.push({
        kind: 'stage',
        stageId: row.id,
        edition: row.edition,
        segment: row.segment,
        role: row.role,
        start: fragment.start,
        end: fragment.end,
        text: fragment.text,
        tags: fragment.tags,
        negated: NEGATION.test(fragment.text),
        // “留到下半场再讲”这类句子只提到概念，并未揭晓内容。
        withheld: WITHHOLDING_NOTE.test(fragment.text)
      });
    }
  }
  return links;
}

function linksForConcept(conceptId, context) {
  return [
    ...stageLinksFor(conceptId, context),
    ...glossaryLinksFor(conceptId, context)
  ];
}

function linkPosition(link, order) {
  const segments = link.segments ?? (link.segment ? [link.segment] : []);
  const positions = segments
    .map(segment => order.indexOf(segment))
    .filter(index => index !== -1);
  return positions.length ? Math.min(...positions) : null;
}

/**
 * 把证据按“本场 / 之前 / 之后 / 其他版本”分组。
 * restrictToCurrentAndPast 为真时，之后场次的依据不能用于本场。
 */
function classifyEvidence({ links, edition, segment, currentIndex, order }) {
  const sameEdition = edition
    ? links.filter(link => link.edition === edition)
    : [];
  const local = sameEdition.filter(link => (link.segments ?? [link.segment]).includes(segment));
  const earlier = [];
  const forward = [];
  for (const link of sameEdition) {
    if ((link.segments ?? [link.segment]).includes(segment)) continue;
    const index = linkPosition(link, order);
    if (index === null) continue;
    if (index < currentIndex) earlier.push(link);
    else if (index > currentIndex) forward.push(link);
  }
  const otherEdition = edition
    ? links.filter(link => link.edition !== edition)
    : links;
  let status = 'unsourced';
  if (!edition) status = 'edition-unknown';
  else if (local.length) status = 'sourced';
  else if (earlier.length) status = 'established-earlier';
  else if (forward.length) status = 'forward';
  else if (otherEdition.length) status = 'other-edition';
  return { status, local, earlier, forward, otherEdition };
}

// ---------------------------------------------------------------------------
// 单句核对
// ---------------------------------------------------------------------------

// 英文自身若已说明“没有/不是实物”，就不再按字面实物报错。
const EN_NEGATED = /\b(?:no|not|never|without)\b[^.]*\b(?:horse|animal|steed)\b|\b(?:horse|animal|steed)\b[^.]*\b(?:is|are)\s+not\b|\bimaginary\b|\bsymbolic\b|\bbare\s+stage\b/iu;
// 句子已经把马处理成虚拟/示意动作时，不再按“真马登场”报错。
const EN_FRAMED_AS_ACTION = /\b(?:mime[sd]?|miming|mount(?:s|ed|ing)?|ride|rides|riding|stylized)\b/iu;
// 英文若已按象征/示意表述，就不再把道具当成纯实物。
const EN_SYMBOLIC = /\b(?:suggest(?:s|ed|ing)?|signals?|signalled|stands? for|represents?|symboli[sz]es?|mimed?|imaginary|stylized)\b/iu;

function conflictingReadings(match, evidence, glossary, edition, sentenceText = '') {
  const conflicts = [];
  if (match.conceptId === 'horse' && match.class === 'animal') {
    if (evidence.local.some(link => link.negated) &&
        !EN_NEGATED.test(sentenceText) &&
        !EN_FRAMED_AS_ACTION.test(sentenceText)) {
      conflicts.push({
        code: 'literal-horse',
        message: '英文写成真实马匹，场记却说明空台、没有实物马；这是把示意动作当成剧情实物。',
        sources: evidence.local
      });
    }
  }
  if (match.conceptId === 'horse-whip' && match.class === 'object') {
    const symbolic = [...evidence.local, ...evidence.earlier, ...evidence.forward]
      .filter(link => link.kind === 'glossary' && SYMBOLIC_GLOSS.test(link.gloss));
    if (symbolic.length && !EN_SYMBOLIC.test(sentenceText)) {
      conflicts.push({
        code: 'prop-as-real',
        message: `本版词义把马鞭解释为示意动作，英文却按实物道具处理。`,
        sources: symbolic
      });
    }
  }
  if (match.conceptId === 'elder-brother' && match.class === 'kin') {
    const mentor = glossary.filter(row =>
      row.edition === edition && KIN_GLOSS.test(row.gloss)
    );
    if (mentor.length) {
      conflicts.push({
        code: 'kin-vs-mentor',
        message: `英文写作亲属关系，词义说明“${mentor[0].term}”是同门称谓；人物关系被改成了血缘。`,
        sources: mentor.map(row => ({
          kind: 'glossary',
          glossaryId: row.id,
          edition: row.edition,
          term: row.term,
          context: row.context,
          gloss: row.gloss,
          segments: [],
          text: `${row.term}：${row.gloss}`,
          tags: ['glossary']
        }))
      });
    }
  }
  if (match.conceptId === 'lend-whip') {
    const transferOnly = /^(?:hands?|gives?|gave|given|passes?|hands over|handed)$/iu.test(match.cue);
    const sourceSaysLend = [...evidence.local, ...evidence.earlier]
      .some(link => LEND_GLOSS.test(link.text ?? ''));
    if (transferOnly && sourceSaysLend) {
      conflicts.push({
        code: 'transfer-drift',
        message: `原文写明“借”，英文“${match.cue}”只表达交付，读者看不出用后归还。`,
        sources: evidence.local.length ? evidence.local : evidence.earlier
      });
    }
  }
  return conflicts;
}

/** 本版此前场次里可用的实例；课堂或改稿可以换用这些讲法。 */
function establishedExamples({ edition, currentIndex, order, links }) {
  return links
    .filter(link => {
      if (link.edition !== edition) return false;
      const index = linkPosition(link, order);
      return index !== null && index < currentIndex;
    })
    .map(link => ({ ...sourceRef(link), position: linkPosition(link, order) }))
    .sort((a, b) => b.position - a.position);
}

/**
 * 本版前场讲过、且明确“留到后面再讲”的实例。
 * 用于把身份类说法换成已经公开的说法；跨概念但同属身份组。
 */
function earlierWithholdingExamples({ edition, currentIndex, order, stageIndex }) {
  const results = [];
  for (const conceptId of IDENTITY_CONCEPTS) {
    for (const link of stageLinksFor(conceptId, { stageIndex })) {
      if (link.edition !== edition || link.kind !== 'stage') continue;
      if (!WITHHOLDING_NOTE.test(link.text ?? '')) continue;
      const index = linkPosition(link, order);
      if (index === null || index >= currentIndex) continue;
      results.push({ ...sourceRef(link), position: index });
    }
  }
  return dedupeRefs(results).sort((a, b) => b.position - a.position);
}

function optionTarget(sentence) {
  return {
    sentence: sentence.index,
    start: sentence.start,
    end: sentence.end,
    text: sentence.text
  };
}

function optionsFor(finding, context) {
  const {
    match, evidence, sentence, order, edition, currentIndex, sentenceCount
  } = context;
  const target = optionTarget(sentence);
  const options = [];
  const localRefs = evidence.local.map(sourceRef);

  if (finding.code === 'literal-horse' && evidence.local.length) {
    options.push({
      kind: 'rewrite-concept',
      target,
      conceptId: 'horse',
      rewriteTo: 'mount',
      rationale: '改写成虚拟的上马/骑行动作，并说明空台无实物；依据同一段场记。',
      evidence: localRefs
    });
  }
  if (finding.code === 'prop-as-real') {
    options.push({
      kind: 'rewrite-concept',
      target,
      conceptId: 'horse-whip',
      rewriteTo: 'stylized-mount',
      rationale: '按本版词义把马鞭写成示意骑行的虚拟动作，而不是实物道具。',
      evidence: evidence.local.map(sourceRef)
    });
  }
  if (finding.code === 'transfer-drift') {
    options.push({
      kind: 'rewrite-concept',
      target,
      conceptId: 'lend-whip',
      rewriteTo: 'lend',
      rationale: '把交付改回“借”，保留用后归还的含义；依据同一段对白。',
      evidence: localRefs
    });
  }
  if (finding.code === 'identity-spoiler' || finding.code === 'kin-vs-mentor') {
    const examples = establishedExamples({
      edition, currentIndex, order,
      links: [...evidence.local, ...evidence.earlier]
    });
    const withholding = [
      ...examples.filter(link => WITHHOLDING_NOTE.test(link.text ?? '')),
      ...earlierWithholdingExamples(context)
    ];
    if (dedupeRefs(withholding).length) {
      options.push({
        kind: 'use-established-example',
        target,
        conceptId: match.conceptId,
        rationale: '改用本版前场已经讲过的说法，不提前点名关系。',
        evidence: dedupeRefs(withholding)
      });
    }
    if (evidence.forward.length) {
      options.push({
        kind: 'defer-to-segment',
        target,
        conceptId: match.conceptId,
        segment: evidence.forward[0].segment,
        rationale: '该解释要到后续场次才有依据；本场卡不应出现，可留到该场次再讲。',
        evidence: evidence.forward.map(sourceRef)
      });
    }
  }
  if (finding.code === 'unsupported-detail' || finding.code === 'no-program-carries-copy') {
    options.push({
      kind: 'verify-source',
      target: sentence ? target : { sentence: null, text: finding.text ?? '' },
      rationale: '资料中没有这一细节的出处；若无场记或唱词可核，应删去或另补依据。',
      evidence: []
    });
  }
  if (finding.code === 'other-edition-only') {
    options.push({
      kind: 'use-established-example',
      target,
      conceptId: match.conceptId,
      rationale: '本版没有这条解释；另一版本的释义不能搬用，需在本版另找实例或删去。',
      evidence: evidence.otherEdition.map(sourceRef)
    });
  }
  // 始终保留“删去这一句”的选项，但排在具体改写之后。
  options.push({
    kind: 'drop-clause',
    target,
    rationale: sentenceCount > 1
      ? '删去这一句，保留同卡中已有出处的其它句子。'
      : '删去这一句，本卡其余内容不受影响。',
    evidence: localRefs
  });
  return options;
}

function traceFor(match, sentence, classification, context) {
  const { edition, currentIndex, order } = context;
  const fallback = classification.local.length
    ? classification.local
    : classification.earlier.length
      ? classification.earlier
      : classification.forward.length
        ? classification.forward
        : classification.otherEdition;
  // 同一句话里既有台词又有编辑注时，优先把台词/动作作为保留的剧情事实；
  // 编辑注只列为补充说明，不冒充剧情。
  const factLinks = fallback.filter(link => sourceKind(link.tags ?? []) === 'fact');
  const primary = factLinks.length ? factLinks : fallback;
  const kind = sourceKind(primary.flatMap(link => link.tags ?? []));
  // 句子已经把说法处理成虚拟/象征/否定时，后续的句间搭配检查不再把它当作实体剧情。
  const framedSymbolic = EN_NEGATED.test(sentence.text) ||
    EN_FRAMED_AS_ACTION.test(sentence.text) ||
    EN_SYMBOLIC.test(sentence.text);
  return {
    conceptId: match.conceptId,
    label: match.label,
    cue: match.cue,
    reading: match.class,
    framedSymbolic,
    start: sentence.start + match.start,
    end: sentence.start + match.end,
    status: classification.status,
    sourceKind: kind,
    negatedSource: classification.local.some(link => link.negated),
    // 本版证据与别版证据分开，避免编辑把别版释义当成本版依据。
    sources: [...classification.local, ...classification.earlier, ...classification.forward]
      .map(sourceRef),
    otherEditionSources: classification.otherEdition.map(sourceRef),
    // 同一说法若在本版词表里有多个 context，全部列出，供编辑选择。
    alternatives: [...classification.local, ...classification.earlier, ...classification.forward]
      .filter(link => link.kind === 'glossary' &&
        (!edition || link.edition === edition))
      .map(link => ({
        kind: 'glossary',
        sourceId: link.glossaryId,
        edition: link.edition,
        term: link.term,
        context: link.context,
        gloss: link.gloss,
        segments: link.segments ?? []
      })),
    establishedExamples: establishedExamples({
      edition, currentIndex, order, links: [...classification.local, ...classification.earlier]
    })
  };
}

function severityFor(code, profile) {
  switch (code) {
    case 'literal-horse':
    case 'kin-vs-mentor':
    case 'copy-segment-cut':
    case 'pairing-compound-arrival':
      return 'blocker';
    case 'identity-spoiler':
      return profile.forbidForwardIdentity ? 'blocker' : 'warning';
    case 'forward-concept':
      return profile.forbidForwardConcepts ? 'warning' : 'info';
    case 'transfer-drift':
    case 'pairing-unclear-referent':
      return 'info';
    default:
      return 'warning';
  }
}

function analyzeSentence(sentence, context) {
  const {
    edition, segment, currentIndex, order, profile
  } = context;
  const matches = conceptsInEn(sentence.text);
  const traces = [];
  const findings = [];

  for (const match of matches) {
    const links = linksForConcept(match.conceptId, context);
    const evidence = classifyEvidence({ links, edition, segment, currentIndex, order });
    const trace = traceFor(match, sentence, evidence, context);
    traces.push(trace);

    const conflicts = conflictingReadings(match, evidence, context.glossary, edition, sentence.text);
    for (const conflict of conflicts) {
      const finding = {
        code: conflict.code,
        severity: severityFor(conflict.code, profile),
        conceptId: match.conceptId,
        sentence: sentence.index,
        message: conflict.message,
        sources: conflict.sources.map(sourceRef),
        options: []
      };
      finding.options = optionsFor(finding, {
        ...context, match, evidence, sentence
      });
      findings.push(finding);
    }

    // 本场对身份概念只有“留到后面再讲”的提示：文本虽提到该词，
    // 但剧情尚未揭晓，任何具体说明都属于提前。
    const localWithheld = IDENTITY_CONCEPTS.has(match.conceptId) &&
      evidence.local.length > 0 &&
      evidence.local.every(link => link.withheld) &&
      !(match.conceptId === 'elder-brother' && match.class === 'kin' &&
        evidence.earlier.length);
    // 另一种情形：本句只是说“稍后会演到识人”，没有点名关系；
    // 与场记“留到下半场”同义，不算揭晓。
    const isScheduleMention = IDENTITY_CONCEPTS.has(match.conceptId) &&
      /\b(?:later|after the interval|later on|still to come|comes later)\b/iu.test(sentence.text) &&
      !/\b(?:brother|sister|sibling|apprentice|stranger|disguise[sd]?|recogni[sz]e[sd]?|recogni[sz]ing|reveal(?:s|ed)?)\b/iu.test(sentence.text);
    if (localWithheld && !isScheduleMention) {
      const finding = {
        code: 'identity-spoiler',
        severity: severityFor('identity-spoiler', profile),
        conceptId: match.conceptId,
        sentence: sentence.index,
        message: `本场只提示“${evidence.local[0].text}”，尚未揭晓；此处具体点名会提前泄露人物关系。`,
        sources: evidence.local.map(sourceRef),
        options: []
      };
      finding.options = optionsFor(finding, { ...context, match, evidence, sentence });
      findings.push(finding);
    }

    // 本场不在节目顺序里（例如已被删除、或介质不含该场次）时，
    // 无法判断“超前/后续”，不应据此报身份泄露；改由 copy 级问题提示。
    if (evidence.status === 'forward' && currentIndex >= 0) {
      const code = IDENTITY_CONCEPTS.has(match.conceptId)
        ? 'identity-spoiler'
        : 'forward-concept';
      const message = IDENTITY_CONCEPTS.has(match.conceptId)
        ? `“${match.cue}”要到 ${evidence.forward[0]?.segment ?? '后续场次'} 才有依据，本场出现会提前揭晓身份。`
        : `“${match.cue}”在本版 ${evidence.forward[0]?.segment ?? '后续场次'} 才出现，本场使用属于超前。`;
      const finding = {
        code,
        severity: severityFor(code, profile),
        conceptId: match.conceptId,
        sentence: sentence.index,
        message,
        sources: evidence.forward.map(sourceRef),
        options: []
      };
      finding.options = optionsFor(finding, {
        ...context, match, evidence, sentence
      });
      findings.push(finding);
    } else if (evidence.status === 'edition-unknown') {
      // 版本本身未定时，不把任何版本的依据说成“别版专属”；
      // 只提示编辑先确定版本（copy 级已报 ambiguous-edition）。
    } else if (evidence.status === 'other-edition') {
      const finding = {
        code: 'other-edition-only',
        severity: 'warning',
        conceptId: match.conceptId,
        sentence: sentence.index,
        message: `“${match.cue}”的解释只存在于其他版本，不能直接用于本版。`,
        sources: evidence.otherEdition.map(sourceRef),
        options: []
      };
      finding.options = optionsFor(finding, { ...context, match, evidence, sentence });
      findings.push(finding);
    } else if (evidence.status === 'unsourced') {
      const finding = {
        code: 'unsupported-detail',
        severity: 'warning',
        conceptId: match.conceptId,
        sentence: sentence.index,
        message: `“${match.cue}”在${edition ?? '本版'}资料中没有场记或词义依据。`,
        sources: [],
        options: []
      };
      finding.options = optionsFor(finding, { ...context, match, evidence, sentence });
      findings.push(finding);
    }

    if (evidence.status === 'established-earlier' && profile.restrictToCurrentAndPast === false) {
      // 课堂可以先讲通用概念，这里不报；但要把依据列出，便于备课。
      trace.note = '依据来自先前场次，可用于课堂铺垫。';
    }
  }

  const blockers = findings.filter(finding => finding.severity === 'blocker');
  const unsourced = traces.filter(trace =>
    ['sourced', 'established-earlier'].includes(trace.status)
  );
  let verdict;
  if (!traces.length) verdict = 'no-concept';
  else if (blockers.length) verdict = 'conflicts-with-source';
  else if (unsourced.length === traces.length) verdict = 'grounded';
  else if (unsourced.length) verdict = 'partly-grounded';
  else verdict = 'unverified';

  return {
    index: sentence.index,
    start: sentence.start,
    end: sentence.end,
    text: sentence.text,
    verdict,
    // 保留的剧情事实：有对白、唱词或动作依据的译法。
    retainedFacts: traces.filter(trace => trace.sourceKind === 'fact' && !trace.negatedSource),
    // 补充说明：依据来自叙述或编译注。
    addedExplanations: traces.filter(trace => trace.sourceKind === 'commentary'),
    unverifiedAdditions: traces.filter(trace => trace.status === 'unsourced'),
    traces,
    findings
  };
}

// ---------------------------------------------------------------------------
// 句间搭配
// ---------------------------------------------------------------------------

/**
 * 句中的定指说法。只取句中（非句首）的“the + 名词”，
 * 因为句首 “The wagon keeper …” 通常是首次介绍，不是回指。
 */
function definiteReferences(sentence) {
  return [...sentence.text.matchAll(/\bthe\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)/giu)]
    .filter(match => match.index > 0)
    .map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
}

function dedupeRefs(refs) {
  const seen = new Set();
  return refs.filter(ref => {
    const key = `${ref.kind}:${ref.sourceId}:${ref.start}:${ref.end}:${ref.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pairingFindings(sentences, profile, context) {
  const findings = [];
  for (let left = 0; left < sentences.length; left += 1) {
    for (let right = left + 1; right < sentences.length; right += 1) {
      const a = sentences[left];
      const b = sentences[right];
      const traces = [...a.traces, ...b.traces];
      const identity = traces.filter(trace => IDENTITY_CONCEPTS.has(trace.conceptId));
      const literalAnimal = traces.find(trace =>
        trace.conceptId === 'horse' && trace.reading === 'animal' && !trace.framedSymbolic
      );
      // 只把“车夫/船客”这类人物当作抵达剧情的另一半；
      // 上马动作本身是示意动作，不能与真马合成抵达。
      const travel = traces.find(trace => ['wagon', 'passenger'].includes(trace.conceptId));

      if (literalAnimal && travel) {
        const target = a.traces.includes(literalAnimal) ? a : b;
        const options = [
          {
            kind: 'drop-clause',
            target: optionTarget(target),
            rationale: `删去第 ${target.index + 1} 句，另一句可独立成立。`,
            evidence: literalAnimal.sources
          },
          {
            kind: 'rewrite-concept',
            conceptId: 'horse',
            rewriteTo: 'mount',
            target: optionTarget(target),
            rationale: '把真马改成场记里的虚拟上马动作，两句就不再合成“真马抵达”。',
            evidence: literalAnimal.sources
          }
        ];
        // 前场已经讲过的实例，可直接换用，避免再造新说法。
        const examples = literalAnimal.establishedExamples.filter(example =>
          example.kind === 'stage' && NEGATION.test(example.text ?? '')
        );
        if (examples.length) {
          options.push({
            kind: 'use-established-example',
            target: optionTarget(target),
            rationale: '换用本版前场已经讲过的实例，读者不会把它当成新剧情。',
            evidence: examples
          });
        }
        findings.push({
          code: 'pairing-compound-arrival',
          severity: 'blocker',
          sentences: [a.index, b.index],
          message: '两句分开看都讲得通，连在一起却会被读成“真实马匹随车夫抵达”的一段剧情。',
          sources: dedupeRefs(literalAnimal.sources),
          options
        });
      }

      if (identity.length && (literalAnimal || travel)) {
        const target = a.traces.some(trace => IDENTITY_CONCEPTS.has(trace.conceptId)) ? a : b;
        findings.push({
          code: 'pairing-identity-arrival',
          severity: profile.forbidForwardIdentity ? 'blocker' : 'warning',
          sentences: [a.index, b.index],
          message: '抵达描写与身份说法并置，会把尚未揭晓的人物关系提前落到这一场上。',
          sources: dedupeRefs(identity.flatMap(trace => trace.sources)),
          options: (() => {
            const options = [{
              kind: 'drop-clause',
              target: optionTarget(target),
              rationale: '删去身份句，只保留可核的动作或抵达描写。',
              evidence: []
            }];
            const withholding = earlierWithholdingExamples(context);
            if (withholding.length) {
              options.push({
                kind: 'use-established-example',
                target: optionTarget(target),
                rationale: '前场已经用“留到后面再讲”的方式提过识人，可换用那套说法。',
                evidence: withholding
              });
            }
            return options;
          })()
        });
      }

      // 同一说法在同一张卡里出现两种读法，读者会以为在讲同一角色/动作。
      // 只对身份类概念追这个风险：车（vehicle）与车夫（role）是不同对象，
      // 并置不会让人误认成同一个。
      const byConcept = new Map();
      for (const trace of traces) {
        if (!IDENTITY_CONCEPTS.has(trace.conceptId)) continue;
        if (!byConcept.has(trace.conceptId)) byConcept.set(trace.conceptId, []);
        byConcept.get(trace.conceptId).push(trace);
      }
      for (const [conceptId, group] of byConcept) {
        const readings = unique(group.map(trace => trace.reading).filter(Boolean));
        if (readings.length < 2) continue;
        const target = b;
        findings.push({
          code: 'same-term-two-readings',
          severity: 'info',
          conceptId,
          sentences: [a.index, b.index],
          message: `同一概念“${group[0].label}”在本卡里分别按 ${readings.join(' / ')} 理解，读者会以为在讲同一角色或动作。`,
          sources: dedupeRefs(group.flatMap(trace => trace.sources)),
          options: [
            {
              kind: 'rewrite-concept',
              conceptId,
              target: optionTarget(target),
              rationale: '统一读法，或删去其中一处，避免两个意思并置。',
              evidence: dedupeRefs(group.flatMap(trace => trace.sources))
            }
          ]
        });
      }

      // 句中回指一个在本卡/本场没有依据的角色，读者无法判断指的是谁。
      // 判据：本句的英文短语本身能对上某个概念（说明是在说角色/物件），
      // 但该概念的证据只在本场之外或完全没有。
      const refs = definiteReferences(b);
      if (refs.length && a.traces.length) {
        const ungrounded = b.traces.filter(trace =>
          ['unsourced', 'forward', 'other-edition'].includes(trace.status)
        );
        const referenced = refs.flatMap(ref =>
          b.traces
            .filter(trace =>
              trace.cue.toLowerCase().startsWith(ref.text.toLowerCase()) ||
              ref.text.toLowerCase().startsWith(trace.cue.toLowerCase()))
            .map(trace => ({ ref, trace }))
        );
        if (referenced.length) {
          const { ref, trace } = referenced[0];
          findings.push({
            code: 'pairing-unclear-referent',
            severity: 'info',
            conceptId: trace.conceptId,
            sentences: [a.index, b.index],
            message: `第 ${b.index + 1} 句的“${ref.text}”在本卡没有先行出处，读者无法判断指的是谁。`,
            sources: trace.sources,
            options: [{
              kind: 'rewrite-concept',
              target: optionTarget(b),
              rationale: '点明人物或删去该指称，避免与上一句的角色混为一人。',
              evidence: trace.sources
            }]
          });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 节目单、字数与改稿归属
// ---------------------------------------------------------------------------

function applyCuts(programRows, cuts) {
  const original = buildPrograms(programRows);
  const active = original.map(program => ({
    ...program,
    orderedSegments: [...program.orderedSegments],
    cutSegments: []
  }));
  const cutRecords = [];
  for (const cut of cuts) {
    const matched = active.filter(program => program.edition === cut.edition);
    if (!matched.length) {
      cutRecords.push({ ...cut, applied: false, reason: `没有版本 ${cut.edition}` });
      continue;
    }
    const appliedTo = [];
    for (const program of matched) {
      const index = program.orderedSegments.indexOf(cut.segment);
      if (index === -1) continue;
      program.orderedSegments.splice(index, 1);
      program.cutSegments.push(cut.segment);
      appliedTo.push(program.id);
    }
    cutRecords.push({
      ...cut,
      applied: appliedTo.length > 0,
      programs: appliedTo,
      reason: appliedTo.length ? null : '该版本的节目单里没有此场次'
    });
  }
  return { original, active, cutRecords };
}

function resolveCopy(copy, { original, active, stageDirections }) {
  const matchesOriginal = findPrograms(original, copy);
  const matchesActive = findPrograms(active, copy);
  const programEditions = unique(matchesOriginal.map(program => program.edition));
  const stageEditions = unique(
    stageDirections.filter(row => row.segment === copy.segment).map(row => row.edition)
  );
  const editions = programEditions.length ? programEditions : stageEditions.slice(0, 1);
  const edition = editions.length === 1 ? editions[0] : null;
  const findings = [];

  if (matchesOriginal.length && !matchesActive.length) {
    findings.push({
      code: 'copy-segment-cut',
      severity: 'blocker',
      message: `该稿所在场次 ${copy.segment} 已被从 ${programEditions.join('、')} 的节目单删除。`,
      sources: stageDirections
        .filter(row => row.segment === copy.segment)
        .map(row => ({
          kind: 'stage', sourceId: row.id, edition: row.edition,
          segment: row.segment, text: row.text
        })),
      options: [{
        kind: 'drop-clause',
        target: { sentence: null, text: copy.text },
        rationale: '场次已删，整条改稿不应再出现在该介质的卡片上。',
        evidence: []
      }]
    });
  } else if (!matchesOriginal.length) {
    const sameMedium = original.filter(program => program.medium === copy.medium);
    findings.push({
      code: 'no-program-carries-copy',
      severity: 'warning',
      message: sameMedium.length
        ? `介质“${copy.medium}”的节目单不含场次 ${copy.segment}；这条稿无法按现有场次单印上该介质。`
        : `没有介质为“${copy.medium}”的节目单，无法确定这条改稿用于哪场演出。`,
      text: copy.text,
      sources: stageDirections
        .filter(row => row.segment === copy.segment)
        .map(row => ({
          kind: 'stage', sourceId: row.id, edition: row.edition,
          segment: row.segment, text: row.text
        })),
      options: [{
        kind: 'verify-source',
        target: { sentence: null, text: copy.text },
        rationale: `先确认这条稿属于哪一场、哪种介质。场次 ${copy.segment} 见于 ${stageEditions.join('、') || '未登记版本'}；现有同介质的节目单未含该场次。`,
        evidence: []
      }]
    });
  }
  if (editions.length > 1) {
    findings.push({
      code: 'ambiguous-edition',
      severity: 'warning',
      message: `同一条稿同时匹配 ${editions.join('、')}，解释需按版本分别核对。`,
      sources: [],
      options: []
    });
  }
  return {
    matchesOriginal,
    matchesActive,
    editions,
    edition,
    findings
  };
}

function lengthReport(copy, programs) {
  const count = codePointLength(copy.text);
  const limits = programs
    .map(program => ({
      programId: program.id,
      edition: program.edition,
      medium: program.medium,
      maxCharacters: program.maxCharacters
    }))
    .filter(item => Number.isFinite(item.maxCharacters));
  if (!limits.length) return { count, limits: [], over: false, remaining: null };
  const strictest = limits.reduce((best, item) =>
    item.maxCharacters < best.maxCharacters ? item : best
  );
  return {
    count,
    limits,
    strictest,
    over: count > strictest.maxCharacters,
    remaining: strictest.maxCharacters - count
  };
}

function analyzeCopy(copy, resolution, context) {
  const {
    active, stageIndex, glossary
  } = context;
  const edition = resolution.edition;
  const program = resolution.matchesActive[0] ?? resolution.matchesOriginal[0] ?? null;
  const profile = profileFor(copy.medium);
  const order = editionOrder(active, edition, context.stageDirections,
    context.excluded[edition] ?? []);
  const currentIndex = order.indexOf(copy.segment);
  const sentences = splitSentences(copy.text)
    .map((sentence, index) => ({ ...sentence, index }));
  const sentenceContext = {
    ...context,
    edition,
    segment: copy.segment,
    currentIndex,
    order,
    profile,
    sentenceCount: sentences.length
  };
  const sentenceAnalyses = sentences.map(sentence =>
    analyzeSentence(sentence, sentenceContext)
  );

  // 课堂讲义不按节目单发放：没有对应场次单不算问题，但仍按版本与场次核对依据。
  const copyFindings = profile.tiedToProgram === false
    ? resolution.findings.filter(finding => finding.code !== 'no-program-carries-copy')
    : resolution.findings;
  const findings = [
    ...copyFindings,
    ...sentenceAnalyses.flatMap(sentence => sentence.findings),
    ...pairingFindings(sentenceAnalyses, profile, sentenceContext)
  ];
  if (profile.tiedToProgram === false && resolution.findings.some(
    finding => finding.code === 'no-program-carries-copy'
  )) {
    findings.push({
      code: 'not-in-program',
      severity: 'info',
      message: `${profile.label}不绑定场次单；本稿按 ${copy.segment} 的场记核对。`,
      sources: [],
      options: []
    });
  }

  // 场次被删后，仍用原节目单的上限评估字数，避免“删了就不限长”的错觉。
  const length = lengthReport(copy, resolution.matchesActive.length
    ? resolution.matchesActive
    : resolution.matchesOriginal);
  if (length.over) {
    findings.push({
      code: 'over-length',
      severity: 'warning',
      message: `该稿 ${length.count} 字符，超过最严上限 ${length.strictest.maxCharacters}（${length.strictest.programId}）。`,
      sources: [],
      options: [{
        kind: 'trim',
        target: { sentence: null, text: copy.text },
        rationale: '按句删减；各句长度见 sentences。',
        evidence: []
      }]
    });
  }

  const allTraces = sentenceAnalyses.flatMap(sentence => sentence.traces);
  // 教师需要先铺垫的通用概念：本版词表里，实例在本场之后、或词条未系于
  // 具体场次的说法。课堂可以先讲概念再引实例；身份类概念不在此列。
  const glossaryTerms = unique(
    glossary
      .filter(row => row.edition === edition)
      .filter(row => {
        const concepts = conceptsInZh(row.term).map(match => match.conceptId);
        if (concepts.some(conceptId => IDENTITY_CONCEPTS.has(conceptId))) return false;
        const anchors = glossaryAnchors(row, {
          stageDirections: context.stageDirections,
          editionSegments: order
        });
        if (!anchors.length) return true;
        return anchors.every(anchor => order.indexOf(anchor) > currentIndex);
      })
      .map(row => conceptsInZh(row.term).map(match => match.conceptId))
      .flat()
  );
  return {
    copyId: copy.id,
    medium: copy.medium,
    segment: copy.segment,
    edition,
    programId: program?.id ?? null,
    profile: {
      id: profile.id,
      label: profile.label,
      audience: profile.audience
    },
    length,
    sentences: sentenceAnalyses,
    findings,
    audience: {
      label: profile.label,
      restrictToCurrentAndPast: profile.restrictToCurrentAndPast,
      forwardIdentity: unique(findings
        .filter(finding => finding.code === 'identity-spoiler')
        .map(finding => finding.conceptId)),
      forwardConcepts: unique(allTraces
        .filter(trace => trace.status === 'forward')
        .map(trace => trace.conceptId)),
      needsTeacherPriming: profile.explainsGeneralConcepts ? glossaryTerms : []
    }
  };
}

// ---------------------------------------------------------------------------
// 术语证据与课堂讲义
// ---------------------------------------------------------------------------

function termSummary({ editions, active, cuts, stageDirections, glossary }) {
  const results = [];
  for (const edition of editions) {
    const removed = unique(cuts.filter(cut => cut.edition === edition).map(cut => cut.segment));
    const order = editionOrder(active, edition, stageDirections, removed);
    const kept = order.filter(segment => !removed.includes(segment));
    // 只盘点本版词表里确实收录的术语；某版没有的词不算“遗失”。
    const terms = unique(
      glossary.filter(row => row.edition === edition).map(row => row.term)
    );
    const evidence = explanationEvidence({
      terms,
      edition,
      keptSegments: kept,
      removedSegments: removed,
      stageDirections,
      glossary
    });
    for (const item of evidence) {
      results.push({
        edition,
        term: item.term,
        stillExplained: item.stillExplained,
        ambiguous: item.ambiguous,
        usable: item.usable.map(candidate => ({
          kind: candidate.kind,
          sourceId: candidate.sourceId,
          edition,
          context: candidate.context,
          gloss: candidate.gloss,
          segments: candidate.supportedBy
        })),
        lost: item.lost.map(candidate => ({
          kind: candidate.kind,
          sourceId: candidate.sourceId,
          edition,
          context: candidate.context,
          gloss: candidate.gloss,
          reasons: candidate.reasons
        }))
      });
    }
  }
  return results;
}

function polysemyFindings(glossary) {
  const byTerm = new Map();
  for (const row of glossary) {
    const key = normalizeTerm(row.term);
    if (!byTerm.has(key)) byTerm.set(key, []);
    byTerm.get(key).push(row);
  }
  const findings = [];
  for (const [key, rows] of byTerm) {
    const editions = unique(rows.map(row => row.edition));
    const contexts = unique(rows.map(row => row.context));
    if (editions.length < 2 || contexts.length < 2) continue;
    findings.push({
      code: 'term-polysemy',
      severity: 'info',
      term: key,
      editions,
      message: `“${rows[0].term}”在不同版本有不同解释（${rows
        .map(row => `${row.edition}：${row.gloss}`).join('；')}），释义必须绑定版本，不能互借。`,
      sources: rows.map(row => ({
        kind: 'glossary',
        sourceId: row.id,
        edition: row.edition,
        term: row.term,
        context: row.context,
        gloss: row.gloss,
        segments: []
      })),
      options: [{
        kind: 'rewrite-concept',
        term: key,
        rationale: '按目标版本重新选定解释，并保留每条候选的出处。',
        evidence: rows.map(row => ({
          kind: 'glossary',
          sourceId: row.id,
          edition: row.edition,
          context: row.context,
          gloss: row.gloss
        }))
      }]
    });
  }
  return findings;
}

function classroomPlan(program, { active, stageDirections, glossary, excluded }) {
  const { edition, orderedSegments } = program;
  const order = editionOrder(active, edition, stageDirections, excluded[edition] ?? []);
  const plans = [];
  for (const segment of orderedSegments) {
    const index = order.indexOf(segment);
    if (index === -1) continue;
    const editionGlossary = glossary.filter(row => row.edition === edition);
    const primer = [];
    const instances = [];
    for (const row of editionGlossary) {
      const anchors = glossaryAnchors(row, {
        stageDirections,
        editionSegments: order
      });
      const anchoredHere = anchors.some(anchor => order.indexOf(anchor) === index);
      const later = anchors.some(anchor => order.indexOf(anchor) > index);
      const earlier = anchors.some(anchor => order.indexOf(anchor) < index && anchor !== segment);
      const entry = {
        term: row.term,
        context: row.context,
        gloss: row.gloss,
        sourceId: row.id,
        anchors
      };
      if (anchoredHere) instances.push(entry);
      else if (!anchors.length) {
        // 词表未系于场次：课堂可先讲通用概念。
        primer.push({ ...entry, reason: '词表未系于某一场次，可作通用概念' });
      } else if (later && !earlier) {
        // 只在后续场次才有实例：先讲通用概念，但仍需标出不要提前点名剧情。
        primer.push({ ...entry, reason: `实例在后续场次 ${anchors.join('、')}，先讲通用概念` });
      }
    }

    const withheld = [];
    for (const row of stageDirections) {
      if (row.edition !== edition) continue;
      const rowIndex = order.indexOf(row.segment);
      if (rowIndex <= index) continue;
      for (const match of conceptsInZh(row.text)) {
        if (!IDENTITY_CONCEPTS.has(match.conceptId)) continue;
        withheld.push({
          conceptId: match.conceptId,
          label: match.label,
          segment: row.segment,
          sourceId: row.id,
          text: row.text
        });
      }
    }
    const stageExamples = stageDirections
      .filter(row => row.edition === edition && row.segment === segment)
      .map(row => ({ sourceId: row.id, role: row.role, text: row.text }));
    const forwardTerms = primer.filter(entry =>
      entry.anchors.some(anchor => order.indexOf(anchor) > index)
    );

    plans.push({
      programId: program.id,
      edition,
      segment,
      order,
      primer,
      instances,
      stageExamples,
      // 教师需要知道哪些通用概念不能在本场直接举例、以免提前揭晓。
      forwardTerms: forwardTerms.map(entry => ({
        term: entry.term,
        anchors: entry.anchors,
        gloss: entry.gloss,
        sourceId: entry.sourceId
      })),
      withheld: [...new Map(withheld.map(item => [`${item.conceptId}:${item.sourceId}`, item])).values()],
      sequence: [
        ...primer.map(entry => ({
          step: 'general', term: entry.term, gloss: entry.gloss, sourceId: entry.sourceId
        })),
        ...instances.map(entry => ({
          step: 'term-instance', term: entry.term, gloss: entry.gloss, sourceId: entry.sourceId
        })),
        ...stageExamples.map(row => ({
          step: 'stage-instance', sourceId: row.sourceId, role: row.role, text: row.text
        }))
      ]
    });
  }
  return plans;
}

function programTotals(active, copies) {
  return active.map(program => {
    const included = copies.filter(copy =>
      copy.medium === program.medium && program.orderedSegments.includes(copy.segment)
    );
    const total = included.reduce((sum, copy) => sum + codePointLength(copy.text), 0);
    return {
      programId: program.id,
      edition: program.edition,
      medium: program.medium,
      segments: program.orderedSegments,
      cutSegments: program.cutSegments,
      copyIds: included.map(copy => copy.id),
      totalCharacters: total,
      maxCharacters: program.maxCharacters,
      over: Number.isFinite(program.maxCharacters) && total > program.maxCharacters
    };
  });
}

/**
 * 生成完整编校报告。
 * cuts 形如 [{ edition: '院落版', segment: '门口' }]；删除后重算节目单与证据。
 */
export function reviewMaterials({ tables, cuts = [] }) {
  const stageDirections = tables['场记.json'];
  const glossary = tables['词义.json'];
  const copies = tables['编辑用稿.json'];
  const programRows = tables['场次单.json'];

  const { original, active, cutRecords } = applyCuts(programRows, cuts);
  const stageIndex = buildStageIndex(stageDirections);
  const excluded = {};
  for (const record of cutRecords) {
    if (!record.applied) continue;
    (excluded[record.edition] ??= []).push(record.segment);
  }
  const context = {
    stageDirections, glossary, stageIndex, active, original, excluded
  };

  const resolutions = copies.map(copy => ({
    copy,
    resolution: resolveCopy(copy, { original, active, stageDirections })
  }));
  const copyReports = resolutions.map(({ copy, resolution }) =>
    analyzeCopy(copy, resolution, context)
  );

  const editions = unique([
    ...stageDirections.map(row => row.edition),
    ...active.map(program => program.edition)
  ]);

  const terms = termSummary({
    editions, active, cuts, stageDirections, glossary
  });

  const termFindings = [];
  for (const summary of terms) {
    if (summary.stillExplained) continue;
    const cutSegments = unique(summary.lost.flatMap(item =>
      item.reasons
        .filter(reason => reason.includes('已删段落'))
        .flatMap(reason => reason.replace(/^依据只来自已删段落\s*/u, '').split('、'))
    ));
    const lostToCut = cutSegments.length > 0;
    termFindings.push({
      code: lostToCut ? 'term-evidence-lost' : 'term-unanchored',
      severity: lostToCut ? 'warning' : 'info',
      edition: summary.edition,
      term: summary.term,
      message: lostToCut
        ? `${summary.edition} 的“${summary.term}”依据只在已删场次 ${cutSegments.join('、')}，删段后已无可用依据；不能借用其他版本的解释。`
        : `${summary.edition} 的“${summary.term}”在资料里无法定位到具体场次，编辑需补充出处。`,
      sources: summary.lost.map(item => ({
        kind: item.kind,
        sourceId: item.sourceId,
        edition: item.edition,
        context: item.context,
        gloss: item.gloss
      })),
      options: [{
        kind: 'rewrite-concept',
        term: summary.term,
        rationale: lostToCut
          ? '为本版补一段可用实例，或删去该解释；其他版本的释义只能作参考。'
          : '补上该术语所在的场记或唱段，再决定能否使用。',
        evidence: summary.lost
      }]
    });
  }

  const reports = copyReports.map(report => {
    const lostTerms = terms.filter(summary =>
      summary.edition === report.edition && !summary.stillExplained &&
      report.sentences.some(sentence => sentence.traces.some(trace =>
        conceptsInZh(summary.term).some(match => match.conceptId === trace.conceptId)
      ))
    );
    return {
      ...report,
      findings: [
        ...report.findings,
        ...lostTerms.map(summary => ({
          code: 'copy-evidence-lost',
          severity: 'warning',
          conceptId: summary.term,
          message: `该稿用到的“${summary.term}”在本版删段后已无独立依据。`,
          sources: summary.lost,
          options: [{
            kind: 'rewrite-concept',
            term: summary.term,
            rationale: '换用本版仍保留的实例，或删去该说法。',
            evidence: summary.lost
          }]
        }))
      ]
    };
  });

  return {
    cuts: cutRecords,
    programs: programTotals(active, copies),
    copies: reports,
    terms,
    termFindings,
    polysemy: polysemyFindings(glossary),
    classroomPlans: active
      .flatMap(program => classroomPlan(program, context))
  };
}

export async function reviewFromDirectory(directory, options = {}) {
  return reviewMaterials({ tables: await readMaterials(directory), ...options });
}

function formatSource(source) {
  const loc = source.start !== null && source.start !== undefined
    ? `:${source.start}-${source.end}`
    : '';
  const edition = source.edition ? `[${source.edition}]` : '';
  return `${source.sourceId}${loc}${edition}`;
}

function formatOption(option) {
  const where = option.target
    ? (option.target.sentence === null
      ? '整条'
      : `第 ${option.target.sentence + 1} 句`)
    : '相关句';
  const detail = option.kind === 'defer-to-segment' && option.segment
    ? ` → ${option.segment}`
    : option.rewriteTo
      ? ` → ${option.rewriteTo}`
      : option.term
        ? ` → ${option.term}`
        : '';
  const evidence = option.evidence?.length
    ? `（依据 ${option.evidence.map(formatSource).join(' ')}）`
    : '';
  const rationale = option.rationale.replace(/[。；]$/u, '');
  return `${option.kind}${detail}（${where}）：${rationale}${evidence}`;
}

/** 单条改稿的详细摘要，含每句保留的事实、补充说明和可选处理。 */
export function copyDigest(copy, cuts = []) {
  const lines = [];
  const applied = cuts.filter(cut => cut.applied &&
    cut.edition === copy.edition && cut.segment === copy.segment);
  lines.push(`改稿 ${copy.copyId}：${copy.segment} / ${copy.medium} / ${copy.edition ?? '版本未定'}`);
  if (copy.programId) lines.push(`节目：${copy.programId}`);
  else lines.push('节目：现有场次单中没有对应演出');
  if (applied.length) {
    lines.push(`注意：${applied.map(cut => `${cut.edition}:${cut.segment}`).join('、')} 已被删除，整条稿不应再印。`);
  }
  lines.push(`字数 ${copy.length.count}${copy.length.strictest ? ` / 上限 ${copy.length.strictest.maxCharacters}` : ''}${copy.length.over ? '（超限）' : ''}`);
  for (const sentence of copy.sentences) {
    lines.push('');
    lines.push(`${sentence.index + 1}. [${sentence.verdict}] ${sentence.text}（${sentence.start}-${sentence.end}）`);
    for (const trace of sentence.traces) {
      const where = trace.sources.map(formatSource).join(' ');
      const other = trace.otherEditionSources.map(formatSource).join(' ');
      const note = trace.note ? `；${trace.note}` : '';
      lines.push(`   - “${trace.cue}”（${trace.reading ?? '未分类'}）→ ${trace.status}${trace.sourceKind ? `/${trace.sourceKind}` : ''}${where ? ` ${where}` : ''}${other ? `（别版：${other}）` : ''}${note}`);
      if (trace.alternatives.length > 1) {
        lines.push(`     可选解释：${trace.alternatives.map(item => `${item.sourceId}「${item.context}」${item.gloss}`).join('；')}`);
      }
      if (trace.establishedExamples.length) {
        lines.push(`     前场实例：${trace.establishedExamples.map(formatSource).join(' ')}`);
      }
    }
  }
  if (copy.findings.length) {
    lines.push('');
    lines.push('问题与可选处理：');
    for (const finding of copy.findings) {
      lines.push(`- [${finding.severity}] ${finding.code}：${finding.message}`);
      for (const source of dedupeRefs(finding.sources ?? [])) {
        lines.push(`    出处 ${formatSource(source)}${source.text ? `「${source.text}」` : ''}`);
      }
      for (const option of finding.options ?? []) {
        lines.push(`    可选：${formatOption(option)}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** 终端可读摘要。 */
export function summarize(report) {
  const lines = [];
  lines.push(`改稿 ${report.copies.length} 条，术语 ${report.terms.length} 项`);
  for (const program of report.programs) {
    const cut = program.cutSegments.length ? `，已删 ${program.cutSegments.join('、')}` : '';
    const limit = Number.isFinite(program.maxCharacters) ? `/${program.maxCharacters}` : '';
    const body = program.segments.length ? program.segments.join('、') : '（无场次）';
    lines.push(`- ${program.programId} ${program.edition} ${program.medium}：${body}${cut}；改稿字数 ${program.totalCharacters}${limit}${program.over ? '（超限）' : ''}`);
  }
  for (const copy of report.copies) {
    const codes = unique(copy.findings.map(finding => finding.code));
    lines.push(`- 改稿 ${copy.copyId}（${copy.segment} / ${copy.medium}，${copy.edition ?? '版本未定'}）：${codes.length ? codes.join('、') : '未发现问题'}`);
    for (const sentence of copy.sentences) {
      lines.push(`  ${sentence.index + 1}. [${sentence.verdict}] ${sentence.text}`);
      for (const trace of sentence.traces) {
        const where = trace.sources.map(formatSource).join(' ');
        const other = trace.otherEditionSources.map(formatSource).join(' ');
        lines.push(`     “${trace.cue}” → ${trace.status}${trace.sourceKind ? `（${trace.sourceKind}）` : ''}${where ? ` ${where}` : ''}${other ? `（别版：${other}）` : ''}`);
      }
    }
    for (const finding of copy.findings) {
      lines.push(`     ! ${finding.severity} ${finding.code}：${finding.message}`);
    }
  }
  for (const finding of [...report.termFindings, ...report.polysemy]) {
    lines.push(`! ${finding.code} ${finding.term ?? ''}：${finding.message}`);
  }
  return `${lines.join('\n')}\n`;
}
