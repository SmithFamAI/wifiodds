#!/usr/bin/env node
'use strict';

/*
 * slop-check.js — a prose linter for the house style guide.
 * Implements WRITING-STYLE.md, which is derived from .research/ai-tells.md.
 *
 * Node, CommonJS, ZERO dependencies. No npm, no spaCy, no network.
 *
 *   node scripts/slop-check.js <file-or-glob>...
 *   const { analyze, analyzeFile } = require('./scripts/slop-check.js');
 *
 * Handles .md, .html, .txt. Emits THREE scores, never one blended number:
 *
 *   LLM-signature    N / 100 words   structural + lexical  (authorship claim)
 *   Cliche           N / 100 words   predates LLMs         (quality only)
 *   Unsubstantiated  N claims        figures with no source/date/link
 *
 * ---------------------------------------------------------------------------
 * WEIGHTING — the tuning choice, stated out loud.
 *
 * research §4: "weight structural tells above lexical ones ... the marketing
 * wordlist is contaminated with 90 years of legitimate copywriting vocabulary."
 * EQ-Bench's Slop Score is 60% wordlist / 25% not-X-but-Y / 15% trigrams; we
 * invert it toward structure.
 *
 *   structural hit = 1.00 pt
 *   lexical family = 0.42 pt
 *   multiword bundle = 0.25 pt          -> 1.00 : 0.42 : 0.25 == 60 : 25 : 15
 *
 * Those three numbers are exactly in 60/25/15 proportion, and the structural
 * unit is pinned at 1.00 so the score reads as "weighted tells per 100 words"
 * and lines up with the thresholds already in WRITING-STYLE.md §8
 * (under 3 fine / 3-6 editing pass / above 6 rewrite). Individual rules carry a
 * severity multiplier inside their group: model-markup leakage is 3x structural
 * because it is near-conclusive; a magic adverb is 0.5x lexical because it is
 * folklore. Every multiplier is visible in the RULES table below.
 *
 * Lexical is scored by DISTINCT FAMILIES, not total hits, per Kousha & Thelwall
 * (underscore ~ pivotal at r=0.449 in 2024 vs 0.032 in 2022). One family scores
 * ZERO. Two score half. Three or more score full. Four-plus escalates.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY NOT IMPLEMENTED. This block is part of the deliverable.
 *
 *  - Perplexity. research §3: seven commercial detectors falsely flagged 61.3%
 *    of TOEFL essays by non-native writers, 19.8% unanimously (Liang et al.,
 *    Patterns 4(7)). Perplexity tracks vocabulary range, which tracks language
 *    proficiency, not authorship. Also Ansari et al. found perplexity ~11 with
 *    NO significant human/AI difference in real edited prose.
 *  - Burstiness. GPTZero invented the metric, states "there is no set threshold
 *    for burstiness," and abandoned it in autumn 2023. Every circulating scale
 *    (0.65-0.85 human) is invented. research §2.
 *  - Lexical-diversity thresholds (TTR/MTLD/STTR). Does not replicate: Jiang &
 *    Hyland found ChatGPT's TTR HIGHER than students'. ACM TIST 2024 showed
 *    MATTR/MTLD move with temperature and frequency penalty, i.e. it is a
 *    decoding parameter, not an authorship property.
 *  - "Bland"/"robotic" prose, formal or academic register, mixed casual/formal
 *    register, perfect grammar. Wikipedia's § Ineffective indicators rules all
 *    four out; mixed register "may indicate ... youth, playfulness, or
 *    neurodivergence."
 *  - A single transition word (however, moreover, furthermore). Wikipedia:
 *    "this is not a strong tell."
 *  - Curly quotes on presence alone. Chicago, Word, macOS and citation tools
 *    all emit them; Gemini and Claude do not. Only inconsistent mixing inside
 *    one file carries signal, and we report that as informational, unscored.
 *  - One em dash. Human baseline 3.23/1000w, range 0.33-17.12. Two Llama
 *    variants emit literally zero, so stripping every dash moves you TOWARD
 *    model output. We flag density >= 5/1000w only.
 *  - One triad. Shu & Carlson (J. Marketing 2014): persuasion PEAKS at exactly
 *    three claims and drops at four. Triad-counting alone is noise; only
 *    saturation, synonym triads and abstract-noun triads are scored.
 *  - CTA microcopy ("no credit card required", "cancel anytime"). research §3:
 *    "Flagging these gives actively harmful advice." Hard-exempted.
 *  - A POS tagger. Zero-dependency constraint. Two features that need one are
 *    approximated by suffix/surface heuristics and LABELLED "~approx" in the
 *    output: nominalization rate (suffix set on all tokens, not NOUN-tagged
 *    tokens) and present-participial rate (comma + -ing surface form). Three
 *    more that need one are SKIPPED entirely rather than faked, because the
 *    surface approximation has no useful precision: agentless-passive rate,
 *    NOUN:VERB ratio, and adjective density. Their absence is stated in the
 *    metrics block so nobody thinks they were measured and passed.
 *  - Register collision, false ranges, invented concept labels, vague
 *    attribution. research §4 lists these as "cannot be regexed, needs an LLM
 *    judge." Not faked. The one exception is the paragraph-terminal summary,
 *    which has a low-FP surface form we do detect.
 *
 * The linter is triage, not a verdict. Five human annotators who use LLMs daily
 * misclassified 1 article in 300; no regex reaches originality or clarity.
 * Wordlists rot in about a year: `delve` collapsed during 2025.
 * WORDLIST VERSION: 2026-07-25.
 */

const fs = require('fs');
const path = require('path');

const WORDLIST_VERSION = '2026-07-25';

/* ========================================================================== *
 * 1. Offset-preserving extraction.
 *
 * Everything we blank out is replaced with the same number of characters
 * (spaces, newlines kept). That means every offset in the scored text is also
 * a valid offset in the raw source, so line numbers are exact and gate checks
 * can look at the RAW slice (which still contains backticks and code) even
 * though scoring only ever sees the visible prose.
 * ========================================================================== */

function blank(src, re) {
  return src.replace(re, (m) => m.replace(/[^\n]/g, ' '));
}

// Block-element boundary marker. Acts as a sentence terminator everywhere, but
// is not a word and is not punctuation, so it distorts no metric.
const BOUNDARY = '\u0001';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019',
  lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', copy: '\u00a9',
  reg: '\u00ae', trade: '\u2122', deg: '\u00b0', times: '\u00d7',
  middot: '\u00b7', bull: '\u2022', check: '\u2713',
};

function decodeEntitiesPreservingLength(s) {
  return s.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,10});/g, (m, body) => {
    let ch;
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      ch = Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    } else {
      ch = ENTITIES[body] || ENTITIES[body.toLowerCase()] || ' ';
    }
    if (ch.length > m.length) ch = ch.slice(0, m.length);
    return ch + ' '.repeat(m.length - ch.length);
  });
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.md' || ext === '.markdown') return 'md';
  return 'txt';
}

/**
 * Produce the scorable text. Same length as `source`, so offsets are shared.
 * opts.ignoreExamples (default true) additionally blanks blockquotes and any
 * region between <!-- slop-check:ignore-start --> / :ignore-end markers, so a
 * style guide that quotes slop as examples can score itself honestly.
 */
function extract(source, kind, opts) {
  const ignoreExamples = !opts || opts.ignoreExamples !== false;
  let s = source;

  // Explicit opt-out regions work in every format.
  if (ignoreExamples) {
    s = blank(s, /<!--\s*slop-check:\s*ignore-start\s*-->[\s\S]*?<!--\s*slop-check:\s*ignore-end\s*-->/gi);
  }

  if (kind === 'html') {
    s = blank(s, /<!--[\s\S]*?-->/g);
    s = blank(s, /<(script|style|svg|template|noscript|head)\b[\s\S]*?<\/\1\s*>/gi);
    s = blank(s, /<(code|pre|kbd|samp|var|tt)\b[\s\S]*?<\/\1\s*>/gi);
    if (ignoreExamples) s = blank(s, /<blockquote\b[\s\S]*?<\/blockquote\s*>/gi);
    // A block-level boundary is a sentence boundary to a reader. Without this a
    // heading runs into its paragraph and a table of one-line cells becomes one
    // 300-word "sentence", which wrecks the length-variance metric, makes every
    // heading look like it restates itself, and lets sentence-scoped regexes
    // match across two unrelated elements. BOUNDARY (U+0001) is used instead of
    // a period so it does not inflate the punctuation-per-token metric. Same
    // length in, same length out.
    s = s.replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|section|article|header|footer|nav|main|aside|td|th|tr|table|dt|dd|dl|figcaption|blockquote|br|hr)\b[^>]*>/gi,
      (m) => BOUNDARY + ' '.repeat(m.length - 1));
    s = blank(s, /<[^>]*>/g);
    s = decodeEntitiesPreservingLength(s);
  } else if (kind === 'md') {
    s = blank(s, /^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm);
    s = blank(s, /^[ \t]*(```|~~~)[\s\S]*$/gm); // unterminated fence
    s = blank(s, /<!--[\s\S]*?-->/g);
    s = blank(s, /<(script|style)\b[\s\S]*?<\/\1\s*>/gi);
    if (ignoreExamples) {
      s = blank(s, /``[^`\n]*``/g);
      // Inline code may wrap across a line in hand-wrapped Markdown, so allow a
      // single newline inside a span but never a blank line (which would let an
      // unbalanced backtick swallow whole paragraphs).
      s = blank(s, /`(?:[^`\n]|\n(?!\s*\n))*`/g);
      s = blank(s, /^[ \t]{0,3}>[^\n]*$/gm);
    }
    s = blank(s, /\((?:https?:|mailto:|\/|#|\.\.?\/)[^)\s]*\)/g);
    s = blank(s, /https?:\/\/\S+/g);
    s = blank(s, /^\s*\[[^\]]+\]:\s*\S+.*$/gm);
    s = decodeEntitiesPreservingLength(s);
  } else {
    s = blank(s, /https?:\/\/\S+/g);
  }

  if (s.length !== source.length) {
    // Belt and braces. Offsets are load-bearing; never let them drift.
    s = s.length > source.length ? s.slice(0, source.length)
                                 : s + ' '.repeat(source.length - s.length);
  }
  return s;
}

/* ========================================================================== *
 * 2. Tokenizing, sentences, line index.
 * ========================================================================== */

const WORD_RE = /[A-Za-z0-9]+(?:['\u2019-][A-Za-z0-9]+)*/g;

function words(text) { return text.match(WORD_RE) || []; }

const ABBREV_TAIL = /\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|St|approx|Fig|No|cf|al|Inc|Ltd|Co|Jr|Sr|Sept|Jan|Feb|Aug|Oct|Nov|Dec|a\.m|p\.m|U\.S|U\.K)\.$/i;

function splitSentences(text) {
  const out = [];
  let start = 0;
  const re = /[.!?\u0001]+(?=["'\u2019\u201d)\]]*(?:\s|$))/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const chunk = text.slice(start, end);
    if (ABBREV_TAIL.test(chunk.trimEnd())) continue;
    if (chunk.trim()) out.push({ start, end, text: chunk });
    start = end;
  }
  if (start < text.length && text.slice(start).trim()) {
    out.push({ start, end: text.length, text: text.slice(start) });
  }
  return out;
}

function makeLineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineOf(lineStarts, offset) {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

/* ========================================================================== *
 * 3. Gates. These are the whole difference between a linter people keep and a
 *    linter people switch off. research §3 is the source for every one.
 * ========================================================================== */

const PROPER_NOUN = /\b[A-Z][a-z]{2,}/;
const DIGIT = /\d/;
const UNIT = /\b(ms|s|sec|secs|seconds|min|mins|minutes|hours?|days?|weeks?|months?|years?|kb|mb|gb|tb|%|px|rem|req\/s|rps|qps|p50|p95|p99)\b/i;
const MONEY = /[$\u00a3\u20ac]\s?\d|\b(usd|eur|gbp)\b/i;
const DATEISH = /\b(19|20)\d\d\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i;
const LIMITATION = /\b(no|not|never|without|only|can'?t|cannot|don'?t|doesn'?t|won'?t|isn'?t|lack|lacks|missing|unsupported|limited to|except|caveat|fails?|breaks?)\b/i;
const COMPARISON = /\b(than|versus|vs\.?|compared|instead of|unlike|whereas)\b/i;

// Slice from `from` to the end of the sentence it sits in, taken from the RAW
// source so backticked identifiers and code survive to be seen by the gate.
function clauseSlice(raw, from, cap) {
  const limit = Math.min(raw.length, from + (cap || 260));
  const seg = raw.slice(from, limit);
  const m = seg.match(/[.!?\u0001](?:\s|$)/);
  return m ? seg.slice(0, m.index + 1) : seg;
}

/** research §4: score a trailing participle only if the clause has no digit,
 *  no proper noun, no backticked token. i.e. it names no mechanism. */
function participleGate(raw, from) {
  const c = clauseSlice(raw, from, 220);
  if (DIGIT.test(c)) return 'names a figure';
  if (/`|<code/.test(c)) return 'names an identifier';
  if (PROPER_NOUN.test(c)) return 'names a proper noun';
  return null;
}

/** research §1G: FLAG = marker AND NOT (next clause has a digit | currency |
 *  unit | proper noun | comparison | date | named limitation). */
function sincerityGate(raw, from) {
  const c = clauseSlice(raw, from, 240);
  if (DIGIT.test(c)) return 'followed by a figure';
  if (MONEY.test(c)) return 'followed by a price';
  if (UNIT.test(c)) return 'followed by a unit';
  if (DATEISH.test(c)) return 'followed by a date';
  if (COMPARISON.test(c)) return 'followed by a comparison';
  if (PROPER_NOUN.test(c.replace(/^[^A-Za-z]*[A-Z]/, ''))) return 'followed by a proper noun';
  if (LIMITATION.test(c)) return 'followed by a named limitation';
  return null;
}

/**
 * Is this offset inside an enumerated word list rather than prose? A run of six
 * or more comma-separated one-to-three-word items is a list of terms (a
 * watchlist, a banned-word list, a set of tags), not a sentence using them. This
 * is the third arm of the "let a style guide score itself honestly" mechanism,
 * alongside blockquote stripping and inline-code stripping.
 */
function inEnumeration(text, index) {
  let s = text.lastIndexOf('\n\n', index);
  let e = text.indexOf('\n\n', index);
  s = s === -1 ? Math.max(0, index - 400) : s;
  e = e === -1 ? Math.min(text.length, index + 400) : e;
  const block = text.slice(s, e);
  const items = block.split(/,\s*/);
  if (items.length < 7) return false;
  const shortItems = items.filter((t) => {
    const w = t.trim().split(/\s+/).filter(Boolean);
    return w.length >= 1 && w.length <= 3;
  }).length;
  return shortItems >= 7 && shortItems / items.length >= 0.75;
}

function near(raw, index, re, radius) {
  const r = radius || 90;
  return re.test(raw.slice(Math.max(0, index - r), index + r));
}

/* ========================================================================== *
 * 4. Rule tables.
 * ========================================================================== */

const PARTICIPLES = 'ensuring|enabling|empowering|allowing|helping|letting|giving|delivering|driving|unlocking|streamlining|enhancing|improving|reducing|eliminating|providing|offering|supporting|facilitating|fostering|highlighting|underscoring|emphasizing|reflecting|showcasing|contributing to|cultivating|encompassing|solidifying|reinforcing|paving the way';

const SELF_ANSWER_NOUNS = 'result|problem|catch|kicker|worst part|best part|scary part|hard part|twist|reality|upside|downside|difference|answer|verdict|bottom line|takeaway|irony|punchline|payoff';

// Lexical families. Scored by DISTINCT FAMILIES hit, not by total hits.
const VOCAB_FAMILIES = {
  'delve/dive': ['delve', 'delves', 'delved', 'delving', 'dive into', 'deep dive'],
  'leverage/harness': ['leverage', 'leverages', 'leveraging', 'harness', 'harnesses', 'harnessing'],
  'foster/cultivate': ['foster', 'fosters', 'fostering', 'cultivate', 'cultivating', 'nurture', 'nurturing'],
  'robust/seamless': ['robust', 'seamless', 'seamlessly', 'frictionless'],
  'holistic/nuanced': ['holistic', 'multifaceted', 'nuanced', 'intricate', 'intricacies', 'interplay'],
  'navigate/landscape': ['navigate', 'navigating', 'landscape', 'realm', 'terrain', 'arena'],
  'tapestry/testament': ['tapestry', 'testament', 'symphony', 'mosaic', 'indelible'],
  'underscore/showcase': ['underscore', 'underscores', 'underscoring', 'underscored', 'showcase', 'showcases', 'showcasing'],
  'elevate/unlock': ['elevate', 'elevates', 'elevating', 'unlock', 'unlocks', 'unlocking', 'supercharge', 'turbocharge', 'embark', 'embarking'],
  'pivotal/crucial': ['pivotal', 'crucial', 'vital', 'paramount', 'integral', 'quintessential'],
  'meticulous': ['meticulous', 'meticulously', 'painstaking', 'painstakingly'],
  'ecosystem/paradigm': ['ecosystem', 'paradigm', 'synergy', 'synergies'],
  'comprehensive/transformative': ['comprehensive', 'transformative', 'cutting-edge', 'game-changer', 'game-changing', 'state-of-the-art', 'revolutionary'],
  'vibrant/garner': ['vibrant', 'garner', 'garnered', 'bolster', 'bolstered', 'amidst', 'palpable', 'camaraderie', 'unravel', 'fleeting', 'unspoken', 'solace'],
  'attitudinal-stance': ['remarkably', 'strikingly', 'notably', 'impressively', 'excitingly', 'fascinating', 'compelling'],
  'magic-adverbs': ['quietly', 'deeply', 'fundamentally', 'arguably'],
  'align/resonate': ['align with', 'aligns with', 'aligning with', 'resonate with', 'resonates with'],
  'enhance/optimize': ['enhance', 'enhances', 'enhancing', 'enhanced'],
};

const VOCAB_SEVERITY = { 'magic-adverbs': 0.5, 'attitudinal-stance': 0.8 };

const PLAINER = {
  delve: 'look at', delves: 'looks at', delving: 'looking at', 'dive into': 'read',
  'deep dive': 'detail', leverage: 'use', leverages: 'uses', leveraging: 'using',
  harness: 'use', foster: 'encourage', fosters: 'encourages', cultivate: 'build',
  robust: 'reliable (or give the number)', seamless: 'delete', seamlessly: 'delete',
  frictionless: 'delete', holistic: 'whole', multifaceted: 'delete', nuanced: 'delete',
  intricate: 'complicated', navigate: 'handle', landscape: 'delete', realm: 'area',
  tapestry: 'delete', testament: 'delete', underscore: 'show', underscores: 'shows',
  showcase: 'show', showcases: 'shows', showcasing: 'showing', elevate: 'improve',
  unlock: 'let you', supercharge: 'speed up', embark: 'start', pivotal: 'important',
  crucial: 'important', vital: 'important', paramount: 'most important',
  meticulous: 'careful', meticulously: 'carefully', ecosystem: 'tools', paradigm: 'model',
  comprehensive: 'complete', transformative: 'delete', 'cutting-edge': 'new',
  'game-changer': 'delete', revolutionary: 'new', vibrant: 'delete', garner: 'get',
  bolster: 'support', amidst: 'amid', enhance: 'improve', enhances: 'improves',
  enhancing: 'improving', enhanced: 'improved', remarkably: 'delete',
  strikingly: 'delete', notably: 'delete', fascinating: 'delete', compelling: 'delete',
  quietly: 'delete', deeply: 'delete', fundamentally: 'delete', arguably: 'delete',
  'align with': 'match', 'resonate with': 'matter to',
};

const BUNDLES = [
  ['plays a (crucial|pivotal|key|vital|significant) role in', 'name the mechanism'],
  ['is a testament to', 'shows'],
  ['in the ever-evolving (landscape|world) of', 'delete'],
  ['it is important to note that', 'delete'],
  ["it'?s worth (noting|mentioning)", 'delete'],
  ['it bears mentioning', 'delete'],
  ['valuable insights', 'name what you learned'],
  ['reflecting broader trends', 'delete'],
  ['contributing to the development of', 'helps build'],
  ['setting the stage for', 'delete'],
  ['a rich tapestry of', 'delete'],
  ['offers a (fascinating|unique) glimpse into', 'shows'],
  ['in this (article|guide|post|piece),? we(\'ll| will) explore', 'delete'],
  ['nestled (within|in|among)', 'in'],
  ['captivates? (both )?[a-z]+ and [a-z]+ alike', 'delete'],
  ['a (deeper|closer) look at', 'delete'],
  ['when it comes to', 'for'],
  ['at its core,?', 'delete'],
  ['not only that,? but', 'and'],
  ['the (world|realm) of', 'delete'],
];

// Chat residue leaking into copy (WP:COLLABCOMM). Near-conclusive, so it sits
// in the bundle group at a 4x multiplier == 1.0 structural-equivalent points.
const CHAT_RESIDUE = [
  "I hope this helps", "Of course!", "Certainly!", "You'?re absolutely right",
  "Would you like me to", "Is there anything else", "Let me know if you'?d like",
  "Here'?s a (more )?detailed breakdown", "As an AI language model",
  "I cannot browse", "based on my training data",
];

const MODEL_MARKUP = [
  'contentReference', 'oaicite', 'oai_citation', 'turn\\d?search\\d', 'attributableIndex',
  '\\[cite:\\s*\\d+\\]', '\\[span_\\d+\\]\\(start_span\\)', 'grok_card',
  'grok_render_citation_card_json', 'ppl-ai-file-upload', ':::writing',
  '20\\d\\d-(XX|xx)-(XX|xx)', 'INSERT_[A-Z_]{3,}', '\\[Your Name\\]', '\\[Specific Topic\\]',
];

const CUTOFF_SPECULATION = [
  'while specific details (are|remain) limited', 'not widely (documented|reported)',
  'based on (the )?available information', 'in the provided sources',
  'maintains a low profile', 'keeps (his|her|their) personal (life|details) private',
  'as of my (last )?(knowledge|training)',
];

const STRUCTURING_SIGNALS = [
  // "in this guide" alone is a legitimate cross-reference ("the other twenty-eight
  // are not in this guide"). The tell is narrating the document, so require the
  // authorial pronoun that turns a reference into an outline announcement.
  "in this (article|guide|post|section|chapter|document),? (we|i|you)('ll|'re| will| are going to| shall)?\\s+\\w+",
  "by the end of this (article|guide|post|section)",
  "first,? we(\'ll| will)",
  "next,? we(\'ll| will) (look|examine|explore|cover)",
  "this (essay|article|post|guide) (argues|explores|examines|will)",
  "now that we\'ve (covered|seen|looked)",
  "let\'s (dive in|dive into|break this down|unpack|explore|take a look)",
  "in the (following|next) section",
  "we\'ll (cover|explore|examine|walk through)",
  "before we (dive|begin|get started)",
];

const SINCERITY_A = [
  ["here'?s the (thing|kicker|deal|catch|twist)", 'cut it; say the thing'],
  ["let'?s be (real|honest|clear)", 'cut it; say the thing'],
  ['real talk', 'cut'],
  ['full transparency', 'cut, or follow it with the actual limitation'],
  ['in the interest of (full )?transparency', 'cut, or name the limitation'],
  ['no (bs|bullshit|fluff|gimmicks|nonsense|catch)', 'cut'],
  ["we (won'?t|will not) sugarcoat", 'cut'],
  ["i'?m not going to pretend", 'cut'],
  ["look,? i'?ll be (upfront|honest)", 'cut'],
  ['at the end of the day', 'cut'],
  ['to be perfectly (honest|clear|frank)', 'cut'],
  ['the (real|honest) (story|question|problem|answer) is', 'just state it'],
];

// Tier B: density (>=3 in a document) OR sentence-initial position only.
const SINCERITY_B = [
  'truly', 'genuinely', 'honestly', 'to be honest', 'transparent', 'transparency',
  'authentic', 'authentically', 'authenticity', 'to be clear', 'simply put',
  'the real deal', 'straight up',
];

// Tier C: NEVER flagged. Present so nobody re-adds them. research §1G: Reinhart
// measured emphatics at 68% and amplifiers at 46% of the human rate -- flagging
// `really` is measurably backwards.
const SINCERITY_C_NEVER = [
  'actually', 'really', 'frankly', 'candid', 'candidly', 'seriously', 'plainly',
  'sincerely', 'genuine', 'real', 'straight talk',
];

const MARKETING = [
  ['designed to', 'say what it does'], ['built for', 'say who uses it'],
  ['purpose-built (to|for)', 'say what it does'], ['empowers? (you|teams|users) to', 'lets you'],
  ['enables? (you|teams|users) to', 'lets you'], ['unlocks? the (power|potential) of', 'delete'],
  ["whether you'?re [^.,\u0001]{2,40}( or |,)", 'pick one reader'],
  ['say goodbye to', 'delete'], ['tired of [^.?\u0001]{2,40}\\?', 'delete'],
  ['sound familiar\\?', 'delete'], ["we'?ve all been there", 'delete'],
  ['stop [a-z]+ing\\.\\s*start [a-z]+ing', 'delete'],
  ['what if you could', 'delete'], ['imagine a world where', 'delete — no legitimate use'],
  ['introducing [A-Z]', 'only for an actual launch; add a date'],
  ['meet [A-Z][a-z]+', 'only for an actual launch; add a date'],
  ['[a-z]+,? (reimagined|redefined|simplified|done right|made simple)', 'delete'],
  ['the future of [^.\u0001]{2,30} is here', 'delete'],
  ['welcome to the future of', 'delete'],
  ['everything you need to', 'list what it does'],
  ['all-in-one', 'delete'], ['all in one place', 'delete'],
  ['one platform for', 'delete'], ["the only [a-z ]{2,25} you'?ll ever need", 'delete'],
  ['that just works', 'delete'], ['finally,? an? [a-z]+ that', 'delete'],
  ['seamlessly integrates', 'integrates'], ['enterprise-grade', 'name the control'],
  ['battle-tested', 'give the load numbers'], ['world-class', 'delete'],
  ['industry-leading', 'delete'], ['best-in-class', 'delete'],
  ['(military|bank)[- ]grade (encryption|security)', 'name the cipher'],
  ['trusted by (thousands|millions|hundreds)', 'name three customers'],
  ['blazingly fast', 'give the number'], ['production-ready', 'delete'],
  ['a powerful yet lightweight', 'delete'],
  ['so you can focus on what (matters|counts)( most)?', 'name the task'],
  ["let'?s dive in", 'delete'], ["let'?s break (this|it) down", 'delete'],
  ["let'?s unpack", 'delete'],
  ['various bug fixes', 'itemize them'], ['under-the-hood improvements', 'itemize them'],
  ['quality-of-life improvements', 'itemize them'],
  ["we'?re excited to announce", 'just announce it'],
  ['this release (brings|introduces|delivers)', 'itemize'],
  ['from its [^.\u0001]{2,40} to its ', 'delete the false range'],
];

const BANNED_WORDS = [
  ['simply', 'delete'], ['easily', 'delete'], ["it'?s that simple", 'delete'],
  ['please note', 'delete'], ['effortlessly', 'delete'], ['with ease', 'delete'],
  ['just (click|run|add|install|type|open|drop|sign up|hit)', 'delete "just"'],
  ['in order to', 'to'], ['going forward', 'delete'], ['moving forward', 'delete'],
  ['one-stop shop', 'delete'], ['at this time', 'now'], ['tl;dr', 'write a first line'],
];

// research §3: flagging these gives actively harmful advice. Hard exemption.
const CTA_EXEMPT = /\b(no credit card required|cancel anytime|start your free trial|book a demo|free forever|no card needed)\b/i;

const GENERIC_HEADINGS = [
  'overview', 'how it works', 'limitations', 'use cases', 'important notes',
  'key features', 'features', 'benefits', 'challenges', 'future outlook',
  'future prospects', 'conclusion', 'final thoughts', 'getting started',
  'introduction', 'background', 'key takeaways', 'summary',
];

// The ladder. The tell is the SEQUENCE, not any single heading.
const LADDER_ORDER = [
  'overview', 'introduction', 'background', 'key features', 'features',
  'how it works', 'benefits', 'use cases', 'challenges', 'limitations',
  'future outlook', 'future prospects', 'conclusion', 'final thoughts',
];

const UNSUB_PATTERNS = [
  // The comparative is required. "up to 15% contamination" is a technical
  // tolerance; "up to 40% faster" is a marketing claim. Only the second needs
  // a methodology link.
  ['up to \\d+(\\.\\d+)?%\\s+(faster|cheaper|better|more|less|smaller|higher|lower|savings|off|improvement|reduction)', 'link the methodology'],
  ['\\d+(\\.\\d+)?x\\s+(faster|cheaper|more|better|higher|lower)', 'link the benchmark'],
  ['\\d{1,3}(\\.\\d+)?%\\s+(uptime|availability|accuracy|precision|recall|of (users|customers|teams))', 'link the SLA or the measurement'],
  ['\\b\\d[\\d,]{2,}\\+?\\s+(users|customers|teams|companies|developers|downloads|installs|subscribers)', 'name the source and the date'],
  ['trusted by (thousands|millions|hundreds|over \\d)', 'name three customers'],
  ['enterprise-grade', 'name SOC 2 / ISO 27001 / HIPAA / FedRAMP / PCI DSS'],
  ['(military|bank)[- ]grade (encryption|security)', 'name the cipher and key length'],
  ['(the )?(#1|number one|world\'?s (best|leading|largest)|industry-leading|best-in-class|most popular)', 'cite the ranking or drop it'],
  ['\\d+(\\.\\d+)?%\\s+(of|more|less|fewer|increase|decrease|improvement|reduction)', 'cite the measurement'],
];

const SUBSTANTIATION = /https?:\/\/|href=|\]\(|\bsource\b|\baccording to\b|\bper\b|\bbenchmark(ed|s)?\b|\bmethodolog|\bSLA\b|\bSOC ?2\b|\bISO ?27001\b|\bHIPAA\b|\bFedRAMP\b|\bPCI ?DSS\b|\bmeasured\b|\bn\s*=\s*\d|\bstandard error\b|\bconfidence interval\b|\bp\s*[<=]\s*0?\.\d|±|\bsample of\b|\b(19|20)\d\d\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d/i;

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}\u{2705}\u{274C}]/u;

const NOMINAL_SUFFIX = /(?:tion|sion|ment|ance|ence|ity|ness|ism|ancy|ency)s?$/i;
const NOMINAL_STOP = new Set([
  'moment', 'moments', 'comment', 'comments', 'element', 'elements', 'cement',
  'garment', 'ornament', 'parliament', 'tournament', 'instrument', 'city',
  'cities', 'pity', 'deity', 'business', 'witness', 'harness', 'illness',
  'mention', 'question', 'questions', 'station', 'stations', 'nation', 'nations',
  'section', 'sections', 'option', 'options', 'version', 'versions', 'entity',
  'entities', 'quantity', 'quality', 'qualities', 'chance', 'chances', 'dance',
  'balance', 'distance', 'instance', 'instances', 'sentence', 'sentences',
  'science', 'audience', 'experience', 'experiences', 'difference', 'differences',
]);

/* ========================================================================== *
 * 5. Exemptions the linter must respect. research §3, style guide §7.
 * ========================================================================== */

const BENCHMARK_NAMES = /\b(p50|p95|p99|SPEC|MLPerf|TPC-[A-Z]|JMH|wrk|ab|k6|Lighthouse|Core Web Vitals|SLO|SLA|CI|regression|variance|estimator|standard error|confidence interval)\b/i;
const SECURITY_CTX = /\b(security|compliance|audit|SOC ?2|ISO ?27001|HIPAA|GDPR|PCI|FedRAMP|vulnerabilit|penetration|threat|coverage|test suite|checklist|policy|policies|risk)\b/i;
const TRANSPARENT_TECH = /\b(background|color|colour|rgba?|hsla?|opacity|alpha|png|gif|webp|css|proxy|proxies|failover|compression|caching|cache|to the caller|to callers|to the user agent|pixel|sprite|overlay|backdrop)\b/i;
const TRULY_TECH = /\btruly\s+(random|asynchronous|async|serverless|idempotent|independent|distributed|stateless|immutable|parallel|concurrent)\b/i;
const NAVIGATE_LITERAL = /\b(map|maps|route|routing|menu|menus|page|pages|url|urls|browser|gps|dom|screen|sidebar|breadcrumb|waypoint|chart|tabs?)\b/i;
const LANDSCAPE_LITERAL = /\b(orientation|mode|photo|photograph|portrait|garden|painting|architecture|aspect|印)\b/i;

function fileIsExemptFromHonestly(file) {
  const b = path.basename(file).toLowerCase();
  return /postmortem|post-mortem|incident|changelog/.test(b);
}

function fileIsExemptFromLadder(file) {
  const b = path.basename(file).toUpperCase();
  return /^(SPEC|RFC|ARCHITECTURE|CHANGELOG|CONTRIBUTING|LICENSE)/.test(b) || /^RFC[-_ ]?\d/.test(b);
}

/** Word-level exemptions applied to lexical hits. Returns a reason or null. */
function lexicalExemption(wordLower, raw, index, file) {
  switch (wordLower) {
    case 'robust':
      if (near(raw, index, /\d/, 80) || near(raw, index, BENCHMARK_NAMES, 90)) return 'statistical/benchmark sense';
      return null;
    case 'comprehensive':
      if (near(raw, index, SECURITY_CTX, 120)) return 'security/compliance context';
      return null;
    case 'navigate': case 'navigating':
      if (near(raw, index, NAVIGATE_LITERAL, 70)) return 'literal navigation';
      return null;
    case 'landscape':
      if (near(raw, index, LANDSCAPE_LITERAL, 70)) return 'literal landscape';
      return null;
    default:
      return null;
  }
}

function sincerityExemption(matchLower, raw, index, file) {
  if (/^transparen/.test(matchLower) && near(raw, index, TRANSPARENT_TECH, 110)) return 'CSS/proxy/PNG sense';
  if (/^authentic/.test(matchLower) && /authenticat/i.test(raw.slice(index, index + 20))) return 'authentication*';
  if (matchLower === 'truly' && TRULY_TECH.test(raw.slice(index, index + 40))) return 'load-bearing technical sense';
  if (/^honest/.test(matchLower) && fileIsExemptFromHonestly(file)) return 'postmortem/incident/changelog';
  return null;
}

/* ========================================================================== *
 * 6. Detectors.
 * ========================================================================== */

const G = { structural: 'structural', lexical: 'lexical', bundle: 'bundle' };
const UNITS = { structural: 1.00, lexical: 0.42, bundle: 0.25 };

function mkHit(o) {
  return Object.assign({
    rule: '', group: G.structural, category: 'llm', sev: 1, line: 0,
    index: 0, match: '', fix: '', note: '', points: 0, gated: null,
  }, o);
}

function scanAll(text, re, fn) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    fn(m);
  }
}

function snippet(text, index, len, pad) {
  const p = pad === undefined ? 0 : pad;
  const s = text.slice(Math.max(0, index - p), Math.min(text.length, index + len + p));
  return s.replace(/\s+/g, ' ').trim();
}

function detect(ctx) {
  const { text, raw, file } = ctx;
  const hits = [];
  const push = (o) => { hits.push(mkHit(o)); };

  /* --- Structural ------------------------------------------------------- */

  // Trailing participial benefit clause, WITH the gate. research §4.
  scanAll(text, new RegExp(',\\s+(' + PARTICIPLES + ')\\b', 'gi'), (m) => {
    const gate = participleGate(raw, m.index + m[0].length);
    push({
      rule: 'trailing-participle', group: G.structural, sev: 1.2,
      index: m.index, match: snippet(text, m.index, m[0].length, 45),
      fix: 'split into two sentences, or put a number in the clause',
      note: 'PNAS d=1.38, 5.3x human rate — the largest effect in the literature',
      gated: gate,
    });
  });

  // Negative parallelism, single sentence. Density-gated below.
  scanAll(text, /\b(?:it|this|that|we|ours?|[A-Z][a-z]+)(?:'s|\u2019s|\s+is|\s+are)?\s+not\s+(?:just|only|merely|simply)\b[^.!?\u0001]{1,120}?[\u2014\u2013,;:-]\s*(?:it|they|this|that)(?:'s|\u2019s|\s+is|\s+are)\b/gi, (m) => {
    push({
      rule: 'negative-parallelism', group: G.structural, sev: 1,
      index: m.index, match: snippet(text, m.index, m[0].length),
      fix: 'say the positive thing once', densityKey: 'negparallel',
    });
  });

  // The cross-sentence reframe a single-sentence regex misses entirely.
  scanAll(text, /\bThe\s+([a-z]{3,15})\b[^.!?\u0001]{0,60}?\b(?:isn'?t|is\s+not)\b[^.!?\u0001]{0,120}[.!?]\s+(?:The\s+\1\s+is\b|It'?s\s+)/gi, (m) => {
    push({
      rule: 'negative-parallelism-cross-sentence', group: G.structural, sev: 1.2,
      index: m.index, match: snippet(text, m.index, m[0].length),
      fix: 'delete the negated sentence; keep the positive one',
      note: 'the variant a single-sentence regex misses', densityKey: 'negparallel',
    });
  });

  scanAll(text, /\bnot\s+(?:only|just)\b[^.!?\u0001]{1,120}?\bbut\s+(?:also\s+)?/gi, (m) => {
    push({
      rule: 'not-only-but-also', group: G.structural, sev: 0.7,
      index: m.index, match: snippet(text, m.index, m[0].length),
      fix: 'split, or drop the first half', densityKey: 'negparallel',
    });
  });

  scanAll(text, /(?:^|[.!?]\s+|>\s*)No\s+\w+[.,]\s*No\s+\w+[.,]\s*(?:Just|Only)\s+\w+/gm, (m) => {
    push({
      rule: 'no-x-no-y-just-z', group: G.structural, sev: 1,
      index: m.index, match: snippet(text, m.index, m[0].length),
      fix: 'one sentence saying what it does', densityKey: 'negparallel',
    });
  });

  scanAll(text, /\b\w+\s+rather\s+than\s+\w+/gi, (m) => {
    push({
      rule: 'x-rather-than-y', group: G.structural, sev: 0.5,
      index: m.index, match: snippet(text, m.index, m[0].length, 25),
      fix: 'state the positive choice', note: 'common in Grok output',
      densityKey: 'negparallel',
    });
  });

  // Self-answering rhetorical question. Near-zero FP rate in product copy.
  scanAll(text, new RegExp('\\b(?:The|Our|Your|And the)\\s+(?:' + SELF_ANSWER_NOUNS + ')\\?\\s+[A-Z\u201c"]', 'g'), (m) => {
    push({
      rule: 'self-answering-question', group: G.structural, sev: 1.2,
      index: m.index, match: snippet(text, m.index, m[0].length + 20),
      fix: 'cut the question, keep the answer',
    });
  });
  scanAll(text, /\bSo\s+what'?s\s+the\s+(?:catch|point|difference|deal)\?/gi, (m) => {
    push({
      rule: 'self-answering-question', group: G.structural, sev: 1,
      index: m.index, match: snippet(text, m.index, m[0].length),
      fix: 'cut the question, keep the answer',
    });
  });

  // Copula avoidance.
  scanAll(text, /\b(serves|stands|functions|operates|acts)\s+as\s+(?:a|an|the)\b/gi, (m) => {
    push({
      rule: 'copula-avoidance', group: G.structural, sev: 1,
      index: m.index, match: snippet(text, m.index, m[0].length, 35),
      fix: 'is',
      note: 'models avoid plain "is" because of the repetition penalty',
    });
  });
  scanAll(text, /\bboasts\s+(?:a|an|\d|over|more)\b/gi, (m) => {
    push({
      rule: 'copula-avoidance', group: G.structural, sev: 1,
      index: m.index, match: snippet(text, m.index, m[0].length, 30), fix: 'has',
    });
  });
  scanAll(text, /\bis\s+a\s+testament\s+to\b/gi, (m) => {
    push({
      rule: 'copula-avoidance', group: G.structural, sev: 1.2,
      index: m.index, match: snippet(text, m.index, m[0].length, 30), fix: 'shows',
    });
  });
  scanAll(text, /\brepresents\s+a\s+(?:shift|milestone|turning point|step|leap|significant)\b/gi, (m) => {
    push({
      rule: 'copula-avoidance', group: G.structural, sev: 0.8,
      index: m.index, match: snippet(text, m.index, m[0].length, 25), fix: 'is',
    });
  });

  // Structuring signals. ChatGPT 6.00% of bundles, students 0.00%.
  scanAll(text, new RegExp('\\b(?:' + STRUCTURING_SIGNALS.join('|') + ')', 'gi'), (m) => {
    push({
      rule: 'structuring-signal', group: G.structural, sev: 1.2,
      index: m.index, match: snippet(text, m.index, m[0].length, 30),
      fix: 'delete — the heading already did that job',
      note: 'Jiang & Hyland: 6.00% of ChatGPT bundles, 0.00% of student bundles',
    });
  });

  // Model markup leakage. Essentially conclusive when present.
  scanAll(text, new RegExp('(?:' + MODEL_MARKUP.join('|') + ')', 'g'), (m) => {
    push({
      rule: 'model-markup-leakage', group: G.structural, sev: 3,
      index: m.index, match: snippet(text, m.index, m[0].length, 20),
      fix: 'remove — this is verbatim model output',
    });
  });

  // Knowledge-cutoff / absence-of-information speculation.
  scanAll(text, new RegExp('\\b(?:' + CUTOFF_SPECULATION.join('|') + ')', 'gi'), (m) => {
    push({
      rule: 'knowledge-cutoff-speculation', group: G.structural, sev: 1,
      index: m.index, match: snippet(text, m.index, m[0].length, 30),
      fix: 'find the fact or drop the sentence',
    });
  });

  // Paragraph-terminal summary — low-FP surface form only.
  scanAll(text, /(?:^|\n)[^\n]*?\b(In summary|In short|Overall|Ultimately|All in all|Taken together|In conclusion|To sum up),/gi, (m) => {
    const idx = m.index + m[0].indexOf(m[1]);
    push({
      rule: 'paragraph-terminal-summary', group: G.structural, sev: 0.8,
      index: idx, match: snippet(text, idx, m[1].length, 45),
      fix: 'end on the last real point',
    });
  });

  // Listicle in a trench coat.
  const listicle = /\bThe\s+first\s+(\w+)\s+is\b[\s\S]{20,600}?\bThe\s+second\s+\1\s+is\b[\s\S]{20,600}?\bThe\s+third\s+\1\s+is\b/gi;
  scanAll(text, listicle, (m) => {
    push({
      rule: 'listicle-in-a-trench-coat', group: G.structural, sev: 1.2,
      index: m.index, match: snippet(text, m.index, 70),
      fix: 'use a real list, or vary the framing',
    });
  });

  // Anaphora abuse — three consecutive sentences opening the same way.
  const sents = splitSentences(text);
  for (let i = 0; i + 2 < sents.length; i++) {
    const key = (s) => (s.text.trim().match(/^\W*(\w+\s+\w+)/) || [, ''])[1].toLowerCase();
    const a = key(sents[i]);
    if (a && a === key(sents[i + 1]) && a === key(sents[i + 2])) {
      push({
        rule: 'anaphora', group: G.structural, sev: 0.8,
        index: sents[i].start, match: snippet(text, sents[i].start, 60),
        fix: 'vary the sentence openings',
      });
      i += 2;
    }
  }

  /* --- Sincerity (structural group; style guide §5) ---------------------- */

  SINCERITY_A.forEach(([pat, fix]) => {
    scanAll(text, new RegExp('\\b(?:' + pat + ')', 'gi'), (m) => {
      const gate = sincerityGate(raw, m.index + m[0].length);
      push({
        rule: 'sincerity-tier-a', group: G.structural, sev: 1,
        index: m.index, match: snippet(text, m.index, m[0].length, 40), fix,
        note: 'sincerity without evidence — a copy-quality rule, NOT an authorship claim',
        gated: gate,
      });
    });
  });

  const tierBRaw = [];
  SINCERITY_B.forEach((w) => {
    const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    scanAll(text, re, (m) => {
      const ex = sincerityExemption(m[0].toLowerCase(), raw, m.index, file);
      if (ex) return;
      tierBRaw.push({ index: m.index, len: m[0].length, word: m[0] });
    });
  });
  const tierBCount = tierBRaw.length;
  tierBRaw.forEach((h) => {
    // Sentence-initial? (position rule) or density rule (>=3 in the document).
    const before = text.slice(Math.max(0, h.index - 120), h.index);
    const initial = /(?:^|[.!?\n]\s*["'\u201c(]?)\s*$/.test(before);
    if (!initial && tierBCount < 3) return;
    const gate = sincerityGate(raw, h.index + h.len);
    push({
      rule: 'sincerity-tier-b', group: G.structural, sev: 0.6,
      index: h.index, match: snippet(text, h.index, h.len, 45),
      fix: 'show the figure, the source or the date instead',
      note: initial ? 'sentence-initial position' : 'density: ' + tierBCount + ' Tier B markers in this file',
      gated: gate,
    });
  });

  /* --- Lexical ---------------------------------------------------------- */

  const familyHits = {};
  Object.keys(VOCAB_FAMILIES).forEach((fam) => {
    VOCAB_FAMILIES[fam].forEach((w) => {
      const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+') + '\\b', 'gi');
      scanAll(text, re, (m) => {
        const lower = m[0].toLowerCase().replace(/\s+/g, ' ');
        const ex = lexicalExemption(lower, raw, m.index, file)
          || (inEnumeration(text, m.index) ? 'inside a word-list enumeration' : null);
        if (!familyHits[fam]) familyHits[fam] = [];
        familyHits[fam].push({ index: m.index, len: m[0].length, word: lower, exempt: ex });
      });
    });
  });

  /* --- Multiword bundles ------------------------------------------------ */

  BUNDLES.forEach(([pat, fix]) => {
    scanAll(text, new RegExp('\\b(?:' + pat + ')', 'gi'), (m) => {
      push({
        rule: 'bundle', group: G.bundle, sev: 1,
        index: m.index, match: snippet(text, m.index, m[0].length, 25), fix,
        gated: inEnumeration(text, m.index) ? 'inside a word-list enumeration' : null,
      });
    });
  });

  CHAT_RESIDUE.forEach((pat) => {
    scanAll(text, new RegExp(pat, 'gi'), (m) => {
      push({
        rule: 'chat-residue', group: G.bundle, sev: 4,
        index: m.index, match: snippet(text, m.index, m[0].length, 20),
        fix: 'delete — this is chat transcript, not copy',
      });
    });
  });

  /* --- Cliche (quality signal; predates LLMs; no authorship claim) ------- */

  const cliche = (o) => { hits.push(mkHit(Object.assign({ category: 'cliche', group: G.lexical }, o))); };

  MARKETING.forEach(([pat, fix]) => {
    scanAll(text, new RegExp('\\b(?:' + pat + ')', 'g' + (/[A-Z]/.test(pat) ? '' : 'i')), (m) => {
      if (CTA_EXEMPT.test(snippet(text, m.index, m[0].length, 40))) return;
      cliche({
        rule: 'marketing', sev: 1, index: m.index,
        match: snippet(text, m.index, m[0].length, 25), fix,
        note: 'predates LLMs — quality signal only',
        gated: inEnumeration(text, m.index) ? 'inside a word-list enumeration' : null,
      });
    });
  });

  BANNED_WORDS.forEach(([pat, fix]) => {
    scanAll(text, new RegExp('\\b(?:' + pat + ')\\b', 'gi'), (m) => {
      if (/^simply put/i.test(text.slice(m.index, m.index + 11))) return;
      cliche({ rule: 'banned-word', sev: 0.8, index: m.index, match: snippet(text, m.index, m[0].length, 25), fix });
    });
  });

  // Synonym triads and abstract-noun triads. NOT plain triads: Shu & Carlson
  // measured persuasion peaking at exactly three claims.
  const SYNONYM_SETS = [
    ['fast', 'quick', 'responsive', 'speedy', 'rapid', 'snappy'],
    ['simple', 'easy', 'straightforward', 'effortless', 'painless'],
    ['powerful', 'robust', 'strong', 'capable'],
    ['secure', 'safe', 'protected', 'private'],
    ['modern', 'sleek', 'clean', 'polished', 'beautiful'],
  ];
  const ABSTRACT_NOUNS = /\b(innovation|collaboration|growth|excellence|synergy|empowerment|transformation|engagement|efficiency|productivity|creativity|scalability|agility)\b/i;
  scanAll(text, /\b([a-z]+),\s+([a-z]+),?\s+and\s+([a-z]+)\b/gi, (m) => {
    const trio = [m[1], m[2], m[3]].map((x) => x.toLowerCase());
    const syn = SYNONYM_SETS.some((set) => trio.every((t) => set.indexOf(t) !== -1));
    const abstract = trio.every((t) => ABSTRACT_NOUNS.test(t));
    if (!syn && !abstract) return;
    cliche({
      rule: syn ? 'synonym-triad' : 'abstract-noun-triad', sev: 1,
      index: m.index, match: snippet(text, m.index, m[0].length),
      fix: syn ? 'pick one word' : 'name what actually happens',
    });
  });

  /* --- Unsubstantiated claims ------------------------------------------- */

  UNSUB_PATTERNS.forEach(([pat, fix]) => {
    scanAll(text, new RegExp(pat, 'gi'), (m) => {
      const around = raw.slice(Math.max(0, m.index - 260), Math.min(raw.length, m.index + m[0].length + 260));
      const cleaned = around.slice(0, 260) + around.slice(260 + m[0].length);
      if (SUBSTANTIATION.test(cleaned)) return;
      hits.push(mkHit({
        rule: 'unsubstantiated', category: 'unsub', group: G.structural, sev: 1,
        index: m.index, match: snippet(text, m.index, m[0].length, 35), fix,
        note: 'no source, date or link within 260 characters',
      }));
    });
  });

  return { hits, familyHits, sents };
}

/* ========================================================================== *
 * 7. Document-level detectors (saturation gates, not first sight).
 * ========================================================================== */

function extractHeadings(source, kind) {
  const out = [];
  if (kind === 'html') {
    scanAll(source, /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (m) => {
      out.push({
        level: +m[1], text: m[2].replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim(),
        index: m.index, end: m.index + m[0].length,
      });
    });
  } else {
    scanAll(source, /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (m) => {
      out.push({
        level: m[1].length, text: m[2].trim(),
        index: m.index, end: m.index + m[0].length,
      });
    });
  }
  return out;
}

function extractBullets(source, kind) {
  const out = [];
  if (kind === 'html') {
    scanAll(source, /<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (m) => {
      out.push({ raw: m[1], index: m.index, boldLead: /^\s*<(strong|b)\b[^>]*>[^<]{1,45}<\/\1>\s*[:\u2014\u2013-]?\s*\S/i.test(m[1]) });
    });
  } else {
    scanAll(source, /^[ \t]*[-*+][ \t]+(.+)$/gm, (m) => {
      out.push({ raw: m[1], index: m.index, boldLead: /^\*\*[^*]{1,45}\*\*\s*[:\u2014\u2013-]?\s+\S/.test(m[1]) });
    });
  }
  return out;
}

function docLevel(ctx) {
  const { text, source, kind, file, wordCount } = ctx;
  const hits = [];
  const metrics = {};
  const push = (o) => hits.push(mkHit(o));
  const per1000 = (n) => (wordCount ? (n * 1000) / wordCount : 0);

  /* Em dash / pivot density. Flagged at >=5 per 1000 words, NOT on occurrence. */
  const emDash = (text.match(/\u2014/g) || []).length;
  const dblHyphen = (text.match(/\s--\s/g) || []).length;
  const spacedHyphen = (text.match(/\w\s-\s\w/g) || []).length;
  // The successor signal: a comma pair enclosing a short mid-sentence aside
  // that is NOT an ordinary relative clause. Counted at 0.25 weight.
  let commaPivots = 0;
  scanAll(text, /(?<=\w),\s+((?:[A-Za-z][\w'\u2019-]*\s+){1,6}[A-Za-z][\w'\u2019-]*),\s+(?=[a-z])/g, (m) => {
    if (/^(which|who|whom|whose|that|where|when|although|though|because|if|while|since|however|therefore|for example|such as|including|and|or|but)\b/i.test(m[1])) return;
    commaPivots++;
  });
  const pivotUnits = emDash + dblHyphen + spacedHyphen + 0.25 * commaPivots;
  const pivotRate = per1000(pivotUnits);
  metrics.emDashPer1000 = round(per1000(emDash), 2);
  metrics.pivotPer1000 = round(pivotRate, 2);
  metrics.pivotBreakdown = { emDash, doubleHyphen: dblHyphen, spacedHyphen, commaPairs: commaPivots };
  if (pivotRate >= 5) {
    push({
      rule: 'pivot-punctuation-density', group: G.structural,
      sev: pivotRate >= 10 ? 2 : 1, index: 0, line: 1,
      match: round(pivotRate, 2) + ' pivots / 1000w (em ' + emDash + ', -- ' + dblHyphen + ', - ' + spacedHyphen + ', comma-pair ' + commaPivots + ')',
      fix: 'rewrite the mid-sentence pivots as sentences',
      note: 'human baseline 3.23 em dashes/1000w (range 0.33-17.12); flagged at >=5, not on occurrence',
    });
  }

  /* Headings: emoji coverage, ladder, generic subheads, level skipping. */
  const headings = extractHeadings(source, kind);
  metrics.headings = headings.length;
  if (headings.length >= 4) {
    const withEmoji = headings.filter((h) => EMOJI.test(h.text.slice(0, 4))).length;
    const cov = withEmoji / headings.length;
    metrics.emojiHeadingCoverage = round(cov, 2);
    if (cov >= 0.8) {
      push({
        rule: 'emoji-heading-saturation', group: G.structural, sev: 1.5,
        index: headings[0].index,
        match: withEmoji + ' of ' + headings.length + ' headings prefixed with an emoji',
        fix: 'drop the emoji, or keep them on a deliberate house-style subset',
        note: 'flagged at >=80% coverage only — awesome-* lists did this before LLMs',
      });
    }
  }

  if (!fileIsExemptFromLadder(file) && headings.length >= 3) {
    const seq = [];
    headings.forEach((h) => {
      const t = h.text.toLowerCase().replace(/[^a-z ]/g, '').trim();
      const i = LADDER_ORDER.indexOf(t);
      if (i !== -1) seq.push({ i, h });
    });
    let best = 0, run = 0;
    for (let k = 0; k < seq.length; k++) {
      if (k === 0 || seq[k].i > seq[k - 1].i) run++; else run = 1;
      best = Math.max(best, run);
    }
    metrics.ladderRun = best;
    if (best >= 3) {
      push({
        rule: 'heading-ladder', group: G.structural, sev: 2,
        index: seq[0].h.index,
        match: seq.map((s) => s.h.text).join(' \u2192 '),
        fix: 'write the sections the material needs',
        note: 'the sequence is the tell, not any one heading (>=3 in canonical order)',
      });
    }
  }

  headings.forEach((h) => {
    const t = h.text.toLowerCase().replace(/[^a-z ]/g, '').trim();
    if (GENERIC_HEADINGS.indexOf(t) !== -1) {
      hits.push(mkHit({
        rule: 'generic-subhead', category: 'cliche', group: G.lexical, sev: 0.4,
        index: h.index, match: h.text,
        fix: 'name the thing the section is about',
        note: 'GitLab Vale HeadingContent; never a standalone authorship signal',
      }));
    }
    if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,}$/.test(h.text) && h.text.split(/\s+/).length >= 3) {
      // Title Case, only reported if most other headings are sentence case.
    }
  });

  // Restating the heading. Content-word overlap >= 0.6. Approximate.
  const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'for', 'and', 'or', 'is', 'are', 'it', 'you', 'your', 'we', 'our', 'this', 'that', 'with', 'on', 'how', 'what', 'why', 'when']);
  headings.forEach((h) => {
    // Read from AFTER the heading element, never from inside it: in HTML the
    // heading and the first paragraph often share a line, and slicing from the
    // heading's own offset made every heading restate itself.
    const after = text.slice(h.end, h.end + 700);
    const first = (splitSentences(after)[0] || { text: '' }).text;
    const hw = words(h.text.toLowerCase()).filter((w) => !STOP.has(w) && w.length > 2);
    if (hw.length < 2) return;
    const fw = new Set(words(first.toLowerCase()));
    const overlap = hw.filter((w) => fw.has(w)).length / hw.length;
    if (overlap >= 0.6) {
      push({
        rule: 'restates-the-heading', group: G.structural, sev: 0.8,
        index: h.end + Math.max(0, after.indexOf(first.trim())),
        match: h.text + '  \u2192  ' + first.replace(/\s+/g, ' ').trim().slice(0, 80),
        fix: 'start with the content',
        note: '~approx: content-word overlap ' + Math.round(overlap * 100) + '%',
      });
    }
  });

  /* Bold-lead-in bullet saturation. All four gates from research §3. */
  const bullets = extractBullets(source, kind);
  metrics.bullets = bullets.length;
  if (bullets.length >= 6) {
    const bold = bullets.filter((b) => b.boldLead);
    const ratio = bold.length / bullets.length;
    // "at least 2 such lists" — count contiguous runs separated by a blank line.
    let lists = 0, prevIdx = -1;
    bold.forEach((b) => {
      if (prevIdx === -1 || source.slice(prevIdx, b.index).indexOf('\n\n') !== -1) lists++;
      prevIdx = b.index;
    });
    const descWords = bold.map((b) => words(b.raw.replace(/^\*\*[^*]*\*\*|^<(strong|b)[^>]*>[\s\S]*?<\/(strong|b)>/i, '')).length).sort((a, b) => a - b);
    const median = descWords.length ? descWords[Math.floor(descWords.length / 2)] : 0;
    const backtickPerBullet = bold.length
      ? bold.reduce((n, b) => n + ((b.raw.match(/`[^`]+`|<code/g) || []).length), 0) / bold.length : 0;
    const leadIsIdent = bold.length
      ? bold.filter((b) => /^\*\*`|^\s*<(strong|b)[^>]*>\s*<code/i.test(b.raw)).length / bold.length : 0;
    metrics.boldLeadInRatio = round(ratio, 2);
    if (ratio >= 0.85 && lists >= 2 && median < 15 && backtickPerBullet < 1 && leadIsIdent < 0.7) {
      push({
        rule: 'bold-lead-in-saturation', group: G.structural, sev: 1.5,
        index: bold[0].index,
        match: bold.length + '/' + bullets.length + ' bullets are **Bold:** lead-ins across ' + lists + ' lists, median ' + median + ' words',
        fix: 'turn half of them back into prose',
        note: 'Google recommends this shape; only saturation is the tell (>=85% + >=2 lists + median <15w + <1 code span/bullet)',
      });
    }
  }

  /* Rule-of-three saturation — fraction of lists with exactly 3 items. */
  if (kind !== 'html') {
    const runs = [];
    let cur = 0, last = -2;
    source.split('\n').forEach((ln, i) => {
      if (/^[ \t]*[-*+][ \t]+/.test(ln) || /^[ \t]*\d+\.[ \t]+/.test(ln)) {
        if (i === last + 1) cur++; else { if (cur) runs.push(cur); cur = 1; }
        last = i;
      }
    });
    if (cur) runs.push(cur);
    if (runs.length >= 4) {
      const threes = runs.filter((r) => r === 3).length / runs.length;
      metrics.listsOfThreeFraction = round(threes, 2);
      if (threes >= 0.6) {
        hits.push(mkHit({
          rule: 'rule-of-three-saturation', category: 'cliche', group: G.lexical, sev: 1,
          index: 0, line: 1,
          match: Math.round(threes * 100) + '% of ' + runs.length + ' lists have exactly 3 items',
          fix: 'let the content decide the count',
          note: 'baseline 0.25-0.35 is an ESTIMATE, not a published figure; one triad is optimal (Shu & Carlson 2014)',
        }));
      }
    }
  }

  /* Exclamation marks in body copy. */
  const bangs = (text.match(/!(?!=)/g) || []).length;
  if (bangs >= 2) {
    hits.push(mkHit({
      rule: 'exclamation-marks', category: 'cliche', group: G.lexical, sev: 0.5,
      index: text.indexOf('!'), match: bangs + ' exclamation marks in body copy',
      fix: 'remove them', note: 'Google style guide bans these; pre-AI rule',
    }));
  }

  return { hits, metrics };
}

/* ========================================================================== *
 * 8. Informational metrics. Reported, never scored (except nominalization,
 *    which the style guide asks to flag above 22/1000w).
 * ========================================================================== */

function informational(ctx) {
  const { text, source, wordCount, sents } = ctx;
  const m = {};
  const per1000 = (n) => (wordCount ? (n * 1000) / wordCount : 0);

  // Sentence-length coefficient of variation. LOW variance is the tell, which
  // inverts the naive intuition. research §2: NO published within-document
  // baseline exists, so this is reported and NEVER scored.
  // Fragments under 4 words are UI chrome (nav labels, table cells, badges,
  // list stubs), not prose. Leaving them in drags the mean down and inflates
  // the spread, which would make every page look reassuringly human.
  const lens = sents.map((s) => words(s.text).length).filter((n) => n >= 4);
  const fragments = sents.length - lens.length;
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const sd = lens.length > 1
    ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (lens.length - 1)) : 0;
  m.sentences = lens.length;
  m.fragmentsIgnored = fragments;
  m.meanSentenceWords = round(mean, 1);
  m.sentenceSD = round(sd, 1);
  m.sentenceCV = round(mean ? sd / mean : 0, 3);
  m.sentenceCVNote = lens.length < 12
    ? 'too few sentences to read'
    : (m.sentenceCV < 0.45
      ? 'LOW spread — human SD is 1.4-2.1x model SD at the same mean. INFORMATIONAL ONLY: no published within-document baseline exists (research §2).'
      : 'within the range you would expect from human prose (informational only)');

  // Punctuation as % of tokens. Human 13.5 +/- 3.3; models 10.7-12.3.
  const punct = (text.match(/[.,;:!?()\[\]{}"'\u2018\u2019\u201c\u201d\u2014\u2013-]/g) || []).length;
  m.punctuationPct = round(wordCount + punct ? (punct * 100) / (wordCount + punct) : 0, 1);
  m.punctuationNote = m.punctuationPct < 10.2
    ? 'BELOW the model range floor (human 13.5 +/- 3.3, models 10.7-12.3) — informational'
    : (m.punctuationPct <= 16.8
      ? 'inside the human range (13.5 +/- 3.3) — informational'
      : 'ABOVE the human range (13.5 +/- 3.3). Not a model signal: only LOW punctuation separates models from humans. Informational.');

  // Nominalization rate, suffix heuristic. APPROXIMATE: without a POS tagger we
  // cannot restrict to NOUN-tagged tokens, so this over-counts adjectives and
  // verbs sharing the suffixes. Human baseline 14.6/1000w (Reinhart). Flag > 22.
  const toks = words(text).map((w) => w.toLowerCase());
  const noms = toks.filter((w) => w.length >= 6 && NOMINAL_SUFFIX.test(w) && !NOMINAL_STOP.has(w));
  m.nominalizationPer1000 = round(per1000(noms.length), 1);
  m.nominalizationNote = '~approx (suffix heuristic, no POS tagger). Human 14.6/1000w; flag above 22.';
  m.nominalizationExamples = Array.from(new Set(noms)).slice(0, 8);

  // Present participial clause rate, surface approximation.
  const partic = (text.match(/,\s+[a-z]+ing\b/gi) || []).length;
  m.commaParticiplePer1000 = round(per1000(partic), 1);
  m.commaParticipleNote = '~approx (comma + -ing surface form, no POS tagger). Human 1.7/1000w; PNAS d=1.38.';

  // Inverted tells — absence is the signal (research §5, items 1 and 2).
  const selfMention = (text.match(/\b(I|we)\s+(think|believe|found|shipped|chose|decided|assume|suspect|reckon|wrote|built|broke|got it wrong)\b/gi) || []).length
    + (text.match(/\bin my (opinion|experience|view)\b/gi) || []).length;
  const hedges = (text.match(/\b(as far as I can tell|in most cases|might be wrong|I'?m not sure|probably|roughly|about|tends to|usually|often|in practice|it depends|perhaps)\b/gi) || []).length;
  m.authorialSelfMentionPer1000 = round(per1000(selfMention), 1);
  m.hedgePer1000 = round(per1000(hedges), 1);
  m.invertedNote = 'INVERTED tells: ChatGPT produced 0 of 2,218 authorial-self-mention bundles vs 85 for students; epistemic stance 5.55% vs 16.54%. LOW is suspicious. Informational, never scored.';

  // Wordy constructions LLMs are trained out of. Their absence is a tell.
  const wordy = (text.match(/\b(as a result of|in order to|all of the|a part of|the fact that|tends to|perhaps|very)\b/gi) || []).length;
  m.humanWordyPer1000 = round(per1000(wordy), 1);

  // Curly-quote mixing. Reported, never scored.
  // Counted on the VISIBLE text, not the source: HTML attribute quotes and
  // Markdown link syntax are not authorship signals.
  const curly = (text.match(/[\u201c\u201d\u2018\u2019]/g) || []).length;
  const straight = (text.match(/["']/g) || []).length;
  m.quotes = { curly, straight };
  m.quotesNote = curly > 0 && straight > 0
    ? 'MIXED curly and straight in one file — the only part of this signal that carries information. Not scored.'
    : 'consistent. Not scored.';

  m.notMeasured = [
    'agentless-passive rate (needs a POS tagger)',
    'NOUN:VERB ratio (needs a POS tagger)',
    'adjective density (needs a POS tagger)',
    'register collision, false ranges, invented concept labels (need a judge)',
  ];
  return m;
}

function round(n, d) { const p = Math.pow(10, d); return Math.round(n * p) / p; }

/* ========================================================================== *
 * 9. Scoring.
 * ========================================================================== */

function score(ctx, detected, docHits, metrics) {
  const wordCount = ctx.wordCount;
  const denom = Math.max(wordCount, 100) / 100;
  const all = detected.hits.concat(docHits);

  // Density gate for negative parallelism: 1 = no flag, 2 = warn, 3+ = strong.
  const npCount = all.filter((h) => h.densityKey === 'negparallel' && !h.gated).length;
  const npMult = npCount <= 1 ? 0 : (npCount === 2 ? 0.5 : 1);

  all.forEach((h) => {
    if (h.gated) { h.points = 0; h.note = (h.note ? h.note + '; ' : '') + 'not scored: ' + h.gated; return; }
    let mult = 1;
    if (h.densityKey === 'negparallel') {
      mult = npMult;
      if (npMult === 0) h.note = (h.note ? h.note + '; ' : '') + 'not scored: 1 per page is human';
      else if (npMult === 0.5) h.note = (h.note ? h.note + '; ' : '') + 'half weight: 2 on the page';
    }
    const unit = h.category === 'cliche' ? 1.0 : UNITS[h.group];
    h.points = round(unit * h.sev * mult, 3);
  });

  // Lexical: DISTINCT FAMILIES, not total hits (Kousha & Thelwall r=0.449).
  const fams = Object.keys(detected.familyHits).filter(
    (f) => detected.familyHits[f].some((x) => !x.exempt)
  );
  const n = fams.length;
  const escalation = n <= 1 ? 0 : (n === 2 ? 0.5 : (n === 3 ? 1.0 : 1.35));
  const lexHits = [];
  fams.forEach((fam) => {
    const live = detected.familyHits[fam].filter((x) => !x.exempt);
    const famPoints = round(UNITS.lexical * (VOCAB_SEVERITY[fam] || 1) * escalation, 3);
    // The family's points are attributed to its first occurrence; the rest are
    // listed at zero so the reader sees them without double counting.
    live.forEach((x, i) => {
      lexHits.push(mkHit({
        rule: 'vocab:' + fam, group: G.lexical, sev: 1,
        index: x.index, match: snippet(ctx.text, x.index, x.len, 30),
        fix: PLAINER[x.word] || 'is there a plainer word that means the same thing here?',
        points: i === 0 ? famPoints : 0,
        note: i === 0
          ? n + ' distinct families in this file (' + (n <= 1 ? 'one family scores zero — coincidence' : n === 2 ? 'half weight' : n === 3 ? 'full weight' : 'escalated: four families is a fingerprint') + ')'
          : 'same family, counted once',
      }));
    });
  });
  Object.keys(detected.familyHits).forEach((fam) => {
    detected.familyHits[fam].filter((x) => x.exempt).forEach((x) => {
      lexHits.push(mkHit({
        rule: 'vocab:' + fam, group: G.lexical, index: x.index,
        match: snippet(ctx.text, x.index, x.len, 30), points: 0,
        note: 'not scored: ' + x.exempt, gated: x.exempt,
      }));
    });
  });

  const combined = all.concat(lexHits);
  const llm = combined.filter((h) => h.category === 'llm');
  const cli = combined.filter((h) => h.category === 'cliche');
  const uns = combined.filter((h) => h.category === 'unsub');

  const sum = (a) => round(a.reduce((t, h) => t + h.points, 0), 3);
  const byGroup = (g) => round(llm.filter((h) => h.group === g).reduce((t, h) => t + h.points, 0), 3);

  return {
    llmSignature: round(sum(llm) / denom, 2),
    cliche: round(sum(cli) / denom, 2),
    unsubstantiated: uns.filter((h) => h.points > 0).length,
    breakdown: {
      structuralPoints: byGroup(G.structural),
      lexicalPoints: byGroup(G.lexical),
      bundlePoints: byGroup(G.bundle),
      distinctVocabFamilies: n,
      families: fams,
      wordCount,
      normalizedAgainst: Math.max(wordCount, 100),
      floorApplied: wordCount < 100,
    },
    hits: combined,
    metrics,
  };
}

/* ========================================================================== *
 * 10. Public API.
 * ========================================================================== */

function analyze(source, opts) {
  const options = opts || {};
  const file = options.file || 'input.txt';
  const kind = options.kind || kindOf(file);
  const text = extract(source, kind, options);
  const wordCount = words(text).length;
  const lineStarts = makeLineIndex(source);
  const ctx = { text, raw: source, source, kind, file, wordCount };

  const detected = detect(ctx);
  ctx.sents = detected.sents;
  const doc = docLevel(ctx);
  const metrics = Object.assign({}, doc.metrics, informational(ctx));

  const result = score(ctx, detected, doc.hits, metrics);
  result.hits.forEach((h) => { h.line = lineOf(lineStarts, h.index); });
  result.hits.sort((a, b) => (b.points - a.points) || (a.line - b.line));
  result.file = file;
  result.kind = kind;
  result.wordlistVersion = WORDLIST_VERSION;

  if (options.sections) result.sections = sectionScores(source, kind, options, lineStarts);
  return result;
}

/** Per-section scores. The style guide asks for this: a 15-word hero is
 *  supposed to be claim-dense, and word-count normalization makes every hero
 *  look terrible and every long FAQ look clean. */
function sectionScores(source, kind, options, lineStarts) {
  const heads = extractHeadings(source, kind);
  if (!heads.length) return [];
  const bounds = [];
  if (heads[0].index > 0) bounds.push({ title: '(before first heading)', start: 0, end: heads[0].index });
  heads.forEach((h, i) => {
    bounds.push({ title: h.text, start: h.index, end: i + 1 < heads.length ? heads[i + 1].index : source.length });
  });
  return bounds.map((b) => {
    const slice = ' '.repeat(b.start) + source.slice(b.start, b.end);
    const r = analyze(slice, Object.assign({}, options, { file: options.file, kind, sections: false }));
    return {
      title: b.title, line: lineOf(lineStarts, b.start), words: r.breakdown.wordCount,
      llmSignature: r.llmSignature, cliche: r.cliche, unsubstantiated: r.unsubstantiated,
    };
  }).filter((s) => s.words > 0);
}

function analyzeFile(file, opts) {
  const source = fs.readFileSync(file, 'utf8');
  return analyze(source, Object.assign({}, opts, { file, kind: (opts && opts.kind) || kindOf(file) }));
}

/* ========================================================================== *
 * 11. CLI.
 * ========================================================================== */

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:[^/]*\\/)*'; i += 2; } else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$.|+()[]{}'.indexOf(c) !== -1) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

const TEXT_EXT = /\.(md|markdown|html?|txt)$/i;

function walk(dir, out, depth) {
  if ((depth || 0) > 12) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  entries.forEach((e) => {
    if (e.name === 'node_modules' || e.name === '.git') return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, (depth || 0) + 1);
    else out.push(p);
  });
  return out;
}

function expandArg(arg) {
  if (!/[*?]/.test(arg)) {
    try {
      const st = fs.statSync(arg);
      if (st.isDirectory()) return walk(arg, []).filter((f) => TEXT_EXT.test(f));
      return [arg];
    } catch (e) { return []; }
  }
  const abs = path.resolve(arg);
  const parts = abs.split(path.sep);
  let baseParts = [];
  for (let i = 0; i < parts.length; i++) {
    if (/[*?]/.test(parts[i])) break;
    baseParts.push(parts[i]);
  }
  const base = baseParts.join(path.sep) || path.sep;
  const re = globToRegex(abs);
  return walk(base, []).filter((f) => re.test(f)).sort();
}

const C = process.stdout.isTTY
  ? { dim: '\u001b[2m', bold: '\u001b[1m', red: '\u001b[31m', yel: '\u001b[33m', grn: '\u001b[32m', off: '\u001b[0m' }
  : { dim: '', bold: '', red: '', yel: '', grn: '', off: '' };

function band(n) {
  if (n < 3) return C.grn + 'ok' + C.off;
  if (n <= 6) return C.yel + 'needs an editing pass' + C.off;
  return C.red + 'rewrite from a fresh outline' + C.off;
}

function report(r, opts) {
  const out = [];
  const b = r.breakdown;
  out.push('');
  out.push(C.bold + r.file + C.off + C.dim + '  (' + r.kind + ', ' + b.wordCount + ' words, wordlist ' + r.wordlistVersion + ')' + C.off);
  out.push('  LLM-signature    ' + pad(r.llmSignature) + ' / 100 words   structural + lexical   ' + band(r.llmSignature));
  out.push('  Cliche           ' + pad(r.cliche) + ' / 100 words   predates LLMs — quality signal only');
  out.push('  Unsubstantiated  ' + pad(r.unsubstantiated) + ' claims        figures with no nearby source, date or link');
  out.push(C.dim + '  weights: structural ' + b.structuralPoints + ' pts (60%) · lexical ' + b.lexicalPoints
    + ' pts (25%) · bundles ' + b.bundlePoints + ' pts (15%) · ' + b.distinctVocabFamilies + ' distinct vocab families'
    + (b.floorApplied ? ' · short text: normalized against a 100-word floor' : '') + C.off);

  const scored = r.hits.filter((h) => h.points > 0);
  const suppressed = r.hits.filter((h) => h.points === 0);
  const limit = opts.top;

  if (scored.length) {
    out.push('');
    out.push('  ' + C.bold + 'Hits, worst first' + C.off + C.dim + '  (' + scored.length + ' scored)' + C.off);
    scored.slice(0, limit).forEach((h) => {
      out.push('  ' + C.dim + String(h.points).padStart(5) + C.off + '  ' + tag(h.category)
        + '  ' + r.file.split('/').pop() + ':' + h.line + '  ' + C.bold + h.rule + C.off);
      out.push('         ' + trunc(h.match, 110));
      if (h.fix) out.push('         ' + C.dim + '\u2192 ' + h.fix + C.off);
      if (h.note && opts.verbose) out.push('         ' + C.dim + h.note + C.off);
    });
    if (scored.length > limit) out.push(C.dim + '         ... ' + (scored.length - limit) + ' more (--top ' + scored.length + ')' + C.off);
  } else {
    out.push('');
    out.push('  ' + C.grn + 'No scored hits.' + C.off + C.dim + ' A low score is not evidence of human authorship.' + C.off);
  }

  if (suppressed.length && opts.showSuppressed) {
    out.push('');
    out.push('  ' + C.dim + 'Detected but not scored (' + suppressed.length + ') — the gates doing their job' + C.off);
    suppressed.slice(0, limit).forEach((h) => {
      out.push('  ' + C.dim + '    .  ' + r.file.split('/').pop() + ':' + h.line + '  ' + h.rule + '  ' + trunc(h.match, 70) + '  [' + (h.gated || h.note) + ']' + C.off);
    });
  }

  if (opts.metrics) {
    const m = r.metrics;
    out.push('');
    out.push('  ' + C.bold + 'Informational metrics' + C.off + C.dim + ' (not scored unless marked)' + C.off);
    out.push('    sentence length      mean ' + m.meanSentenceWords + 'w, SD ' + m.sentenceSD + ', CV ' + m.sentenceCV
      + C.dim + '  (' + m.sentences + ' sentences, ' + m.fragmentsIgnored + ' short fragments ignored)' + C.off);
    out.push('      ' + C.dim + m.sentenceCVNote + C.off);
    out.push('    punctuation          ' + m.punctuationPct + '% of tokens');
    out.push('      ' + C.dim + m.punctuationNote + C.off);
    out.push('    nominalization       ' + m.nominalizationPer1000 + ' /1000w  ~approx' + (m.nominalizationPer1000 > 22 ? C.yel + '  ABOVE 22 — SCORED' + C.off : ''));
    out.push('      ' + C.dim + m.nominalizationNote + C.off);
    out.push('    comma+participle     ' + m.commaParticiplePer1000 + ' /1000w  ~approx (human 1.7)');
    out.push('    pivot punctuation    ' + (m.pivotPer1000 === undefined ? 0 : m.pivotPer1000) + ' /1000w  (em dash alone ' + (m.emDashPer1000 || 0) + '; flag at >=5)');
    out.push('    authorial self-mention ' + m.authorialSelfMentionPer1000 + ' /1000w   hedges ' + m.hedgePer1000 + ' /1000w');
    out.push('      ' + C.dim + m.invertedNote + C.off);
    out.push('    human wordy forms    ' + m.humanWordyPer1000 + ' /1000w  (absence is a tell)');
    out.push('    quotes               curly ' + m.quotes.curly + ', straight ' + m.quotes.straight + ' — ' + m.quotesNote);
    out.push('    ' + C.dim + 'not measured: ' + m.notMeasured.join('; ') + C.off);
  }

  if (r.sections && r.sections.length) {
    out.push('');
    out.push('  ' + C.bold + 'Per section' + C.off + C.dim + ' (a 15-word hero is supposed to be claim-dense)' + C.off);
    r.sections.forEach((s) => {
      out.push('    ' + String(s.line).padStart(5) + '  ' + pad(s.llmSignature) + '  ' + pad(s.cliche)
        + '  ' + String(s.words).padStart(5) + 'w  ' + trunc(s.title, 60));
    });
    out.push('    ' + C.dim + 'line   LLM  clich  words  section' + C.off);
  }

  return out.join('\n');
}

function pad(n) { return String(n).padStart(6); }
function trunc(s, n) { s = String(s).replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
function tag(cat) {
  if (cat === 'llm') return C.red + 'LLM  ' + C.off;
  if (cat === 'cliche') return C.yel + 'CLICH' + C.off;
  return C.yel + 'UNSUB' + C.off;
}

function main(argv) {
  const opts = {
    top: 25, metrics: true, verbose: false, showSuppressed: false,
    ignoreExamples: true, sections: false, json: false, maxSignature: null,
  };
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-signature') opts.maxSignature = parseFloat(argv[++i]);
    else if (a.indexOf('--max-signature=') === 0) opts.maxSignature = parseFloat(a.split('=')[1]);
    else if (a === '--top') opts.top = parseInt(argv[++i], 10);
    else if (a.indexOf('--top=') === 0) opts.top = parseInt(a.split('=')[1], 10);
    else if (a === '--json') opts.json = true;
    else if (a === '--sections') opts.sections = true;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--show-suppressed') opts.showSuppressed = true;
    else if (a === '--no-metrics') opts.metrics = false;
    else if (a === '--no-ignore-examples') opts.ignoreExamples = false;
    else if (a === '--help' || a === '-h') { usage(); return 0; }
    else if (a[0] === '-') { process.stderr.write('unknown option: ' + a + '\n'); usage(); return 0; }
    else files.push(a);
  }
  if (!files.length) { usage(); return 0; }

  const targets = [];
  files.forEach((f) => expandArg(f).forEach((t) => { if (targets.indexOf(t) === -1) targets.push(t); }));
  if (!targets.length) { process.stderr.write('no matching files\n'); return 0; }

  const results = targets.map((f) => {
    try { return analyzeFile(f, opts); }
    catch (e) { process.stderr.write('skip ' + f + ': ' + e.message + '\n'); return null; }
  }).filter(Boolean);

  if (opts.json) {
    process.stdout.write(JSON.stringify(results.map((r) => ({
      file: r.file, llmSignature: r.llmSignature, cliche: r.cliche,
      unsubstantiated: r.unsubstantiated, breakdown: r.breakdown, metrics: r.metrics,
      sections: r.sections,
      hits: r.hits.filter((h) => h.points > 0).map((h) => ({
        rule: h.rule, category: h.category, group: h.group, line: h.line,
        points: h.points, match: h.match, fix: h.fix, note: h.note,
      })),
    })), null, 2) + '\n');
  } else {
    results.forEach((r) => process.stdout.write(report(r, opts) + '\n'));
    process.stdout.write('\n' + C.dim
      + 'Triage, not a verdict. Five human annotators who use LLMs daily misclassified 1 article in 300;\n'
      + 'no regex reaches originality or clarity. Wordlists rot in about a year — this one is ' + WORDLIST_VERSION + '.\n'
      + 'A low score is not evidence of human authorship.' + C.off + '\n');
  }

  if (opts.maxSignature !== null && !Number.isNaN(opts.maxSignature)) {
    const over = results.filter((r) => r.llmSignature > opts.maxSignature);
    if (over.length) {
      process.stderr.write('\nslop-check: ' + over.length + ' file(s) above --max-signature '
        + opts.maxSignature + ': ' + over.map((r) => r.file + ' (' + r.llmSignature + ')').join(', ') + '\n');
      return 1;
    }
  }
  return 0; // exit 0 always, unless --max-signature was opted into and exceeded
}

function usage() {
  process.stdout.write([
    'slop-check ' + WORDLIST_VERSION + ' — three scores, never one blended number.',
    '',
    '  node scripts/slop-check.js [options] <file-or-glob>...',
    '',
    '  --max-signature N     exit 1 when LLM-signature exceeds N (default: always exit 0)',
    '  --top N               show N hits per file (default 25)',
    '  --sections            per-section scores as well as per-document',
    '  --json                machine-readable output',
    '  --show-suppressed     list detections the gates deliberately did not score',
    '  --no-ignore-examples  score blockquotes and inline code too (a style guide',
    '                        that quotes slop as examples needs the default, which is ON)',
    '  --no-metrics          hide the informational metrics block',
    '  -v, --verbose         show the research note behind each hit',
    '',
  ].join('\n') + '\n');
}

module.exports = {
  analyze, analyzeFile, extract, kindOf, words, splitSentences,
  VOCAB_FAMILIES, BUNDLES, MARKETING, SINCERITY_A, SINCERITY_B, SINCERITY_C_NEVER,
  UNITS, WORDLIST_VERSION, main,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
