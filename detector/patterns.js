/**
 * Avoid AI Writing — detection engine (canonical source of truth)
 * Implements 44-category pattern detection. This repo's SKILL.md
 * catalogs the human-editable pattern rules; this engine is the executable
 * expression of the regex-detectable subset and extends it with stylometric and
 * AI-tool-fingerprint detectors that don't make sense as skill prose
 * (cross-paragraph burstiness, smart-punct signatures, function-word
 * trigram entropy, low type-token ratio, AI-tool URL parameters,
 * chatbot citation markup leaks, unfilled placeholders).
 *
 * Scoring model:
 *   Each category has a weight in the ISSUE_WEIGHTS table. Detection runs
 *   produce raw (possibly duplicate) issues which are then deduplicated by
 *   (type, text) pair. rawScore is the sum of category weights across the
 *   deduped list — so the number reflects the same distinct signals the
 *   user sees in the issue list.
 *
 *   Weights are deliberately non-flat across severity tags. Cutoff
 *   disclaimers (10) and chatbot artifacts (8) weigh more than vague
 *   attributions (5), even though all three are tagged `critical`, because
 *   the skill treats them as stronger or weaker AI-origin signals.
 *
 *   rawScore is then normalized to 0-100 via `log2(wordCount/50)` so longer
 *   texts don't accumulate unboundedly on the same density of patterns.
 */

const AIDetector = (() => {
  // ═══ Tier 1 pre-pass: normalize bypass tricks ══════════════════════
  //
  // Humanizer tools and prompt-injection bypass techniques insert
  // invisible / lookalike chars to defeat exact-string detectors. Strip
  // them BEFORE pattern matching so "delve" with a Cyrillic 'е' still
  // hits the Tier 1 list. Unicode ranges sourced from
  // It-s-AI/llm-detection/detection/attacks/.
  //
  // Tracks what was stripped so the trinary classifier can use
  // "normalization triggered" as a corroborating AI signal — humans don't
  // paste ZWSPs into their own writing.
  const CYRILLIC_LOOKALIKES = {
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x',
    'у': 'y', 'к': 'k', 'м': 'm', 'н': 'h', 'в': 'b', 'т': 't',
    'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C', 'Х': 'X',
    'У': 'Y', 'К': 'K', 'М': 'M', 'Н': 'H', 'В': 'B', 'Т': 'T',
  };
  const GREEK_LOOKALIKES = { 'ο': 'o', 'Ο': 'O', 'α': 'a', 'Α': 'A', 'ρ': 'p', 'Ρ': 'P' };

  function normalizeText(text) {
    const flags = { zeroWidth: 0, homoglyph: 0, roleplay: 0 };
    let out = text;

    // 1. Strip zero-width chars (ZWSP U+200B, ZWNJ U+200C, ZWJ U+200D,
    //    BOM U+FEFF, word joiner U+2060).
    out = out.replace(/[​-‍﻿⁠]/g, () => { flags.zeroWidth++; return ''; });

    // 2. Swap Cyrillic / Greek Latin-lookalike chars back to Latin so
    //    pattern matching catches obfuscated tokens.
    out = out.replace(/[Ѐ-ӿͰ-Ͽ]/g, (m) => {
      const swap = CYRILLIC_LOOKALIKES[m] ?? GREEK_LOOKALIKES[m];
      if (swap) { flags.homoglyph++; return swap; }
      return m;
    });

    // 3. Strip *roleplay-action* markers — paired *...* containing an
    //    action verb (nods, sighs, laughs, smiles, etc.) anchored to
    //    the start of the inner phrase. This is the actual chat-model
    //    artifact shape. Markdown `**bold**` is rejected by the
    //    lookbehind/lookahead; legitimate multi-word `*italic*` is
    //    preserved because the verb whitelist is narrow.
    const ROLEPLAY_VERBS = /^(?:nods|sighs|laughs|smiles|frowns|shrugs|grins|winks|chuckles|gasps|pauses|thinks|wonders|whispers|shouts|gestures|raises|leans|turns|looks|glances|smirks|blinks|nodding|sighing|laughing|smiling|thinking|gesturing)\b/i;
    out = out.replace(/(?<!\*)\*([^*\n]{1,80}?)\*(?!\*)/gu, (m, inner) => {
      if (ROLEPLAY_VERBS.test(inner)) { flags.roleplay++; return ''; }
      return m;
    });

    return { text: out, flags };
  }

  // ─── Tier 1: Always flag ───────────────────────────────────────────
  const TIER1 = {
    'delve': 'explore, dig into, look at',
    'tapestry': 'describe the actual complexity',
    'paradigm': 'model, approach, framework',
    'beacon': 'rewrite entirely',
    'robust': 'strong, reliable, solid',
    'comprehensive': 'thorough, complete, full',
    'cutting-edge': 'latest, newest, advanced',
    'pivotal': 'important, key, critical',
    'meticulous': 'careful, detailed, precise',
    'meticulously': 'carefully, precisely',
    'seamless': 'smooth, easy, without friction',
    'seamlessly': 'smoothly, easily',
    'game-changer': 'describe what changed',
    'game-changing': 'describe what changed',
    'nestled': 'is located, sits',
    'vibrant': 'describe what makes it active',
    'thriving': 'growing, active',
    'bustling': 'busy, active',
    'intricate': 'complex, detailed',
    'intricacies': 'complexities, details',
    'ever-evolving': 'changing, growing',
    'enduring': 'lasting, long-running',
    'daunting': 'hard, difficult',
    'holistic': 'complete, full, whole',
    'holistically': 'completely, fully',
    'actionable': 'practical, useful, concrete',
    'impactful': 'effective, significant',
    'learnings': 'lessons, findings, takeaways',
    'synergy': 'describe the combined effect',
    'synergies': 'describe the combined effect',
    'interplay': 'relationship, connection',
    'symphony': 'describe the coordination',
    'embrace': 'adopt, accept, use',
  };

  // Multi-word tier 1 phrases
  const TIER1_PHRASES = [
    { pattern: /\bdelve\s+into\b/gi, replace: 'explore, dig into' },
    { pattern: /\blandscape\b/gi, replace: 'field, space, industry', filter: true },
    { pattern: /\brealm\b/gi, replace: 'area, field, domain' },
    { pattern: /\btestament\s+to\b/gi, replace: 'shows, proves' },
    { pattern: /\bleverag(?:e|es|ing|ed)\b/gi, replace: 'use' },
    { pattern: /\bwatershed\s+moment\b/gi, replace: 'turning point, shift' },
    { pattern: /\bmarking\s+a\s+pivotal\s+moment\b/gi, replace: 'state what happened' },
    { pattern: /\bthe\s+future\s+looks\s+bright\b/gi, replace: 'cut or say something specific' },
    { pattern: /\bonly\s+time\s+will\s+tell\b/gi, replace: 'cut or say something specific' },
    { pattern: /\bdespite\s+challenges[^.]*continues?\s+to\s+thrive\b/gi, replace: 'name the challenge and response' },
    { pattern: /\bdeep\s+dive\b/gi, replace: 'look at, examine' },
    { pattern: /\bdive\s+into\b/gi, replace: 'look at, examine' },
    { pattern: /\bunpack(?:ing)?\b/gi, replace: 'explain, break down' },
    { pattern: /\bcomplexities\b/gi, replace: 'name the actual problems' },
    { pattern: /\bthought\s+leader(?:ship)?\b/gi, replace: 'expert, authority' },
    { pattern: /\bbest\s+practices\b/gi, replace: 'what works, proven methods' },
    { pattern: /\bat\s+its\s+core\b/gi, replace: 'cut, just state it' },
    { pattern: /\bin\s+order\s+to\b/gi, replace: 'to' },
    { pattern: /\bdue\s+to\s+the\s+fact\s+that\b/gi, replace: 'because' },
    { pattern: /\bserves\s+as\b/gi, replace: 'is' },
    { pattern: /\bfeatures\b/gi, replace: 'has, includes', filter: true },
    { pattern: /\bboasts\b/gi, replace: 'has' },
    { pattern: /\butiliz(?:e|es|ing|ed)\b/gi, replace: 'use' },
    { pattern: /\bshowcas(?:e|es|ing|ed)\b/gi, replace: 'show, demonstrate' },
    { pattern: /\bembark(?:s|ing|ed)?\b/gi, replace: 'start, begin' },
    { pattern: /\bcommenc(?:e|es|ing|ed)\b/gi, replace: 'start, begin' },
    { pattern: /\bascertain(?:s|ing|ed)?\b/gi, replace: 'find out, determine' },
    { pattern: /\bendeavou?r(?:s|ing|ed)?\b/gi, replace: 'effort, attempt, try' },
    { pattern: /\bunderscor(?:es|ing|ed)\b/gi, replace: 'highlights, shows' },
  ];

  // ─── Tier 2: Flag in clusters (2+ per paragraph) ──────────────────
  const TIER2 = {
    'harness': 'use, take advantage of',
    'navigate': 'work through, handle',
    'navigating': 'working through, handling',
    'foster': 'encourage, support, build',
    'elevate': 'improve, raise, strengthen',
    'unleash': 'release, enable, unlock',
    'streamline': 'simplify, speed up',
    'empower': 'enable, let, allow',
    'bolster': 'support, strengthen',
    'spearhead': 'lead, drive, run',
    'resonate': 'connect with, appeal to',
    'resonates': 'connects with, appeals to',
    'revolutionize': 'change, transform',
    'facilitate': 'enable, help, allow',
    'facilitates': 'enables, helps, allows',
    'underpin': 'support, form the basis of',
    'nuanced': 'specific, subtle, detailed',
    'crucial': 'important, key, necessary',
    'multifaceted': 'describe the actual facets',
    'ecosystem': 'system, community, network',
    'myriad': 'many, numerous',
    'plethora': 'many, a lot of',
    'encompass': 'include, cover, span',
    'catalyze': 'start, trigger, accelerate',
    'reimagine': 'rethink, redesign, rebuild',
    'galvanize': 'motivate, rally, push',
    'augment': 'add to, expand, supplement',
    'cultivate': 'build, develop, grow',
    'illuminate': 'clarify, explain, show',
    'elucidate': 'explain, clarify',
    'juxtapose': 'compare, contrast',
    'transformative': 'describe what changed',
    'transformation': 'describe what changed',
    'cornerstone': 'foundation, basis, key part',
    'paramount': 'most important, top priority',
    'poised': 'ready, set, about to',
    'burgeoning': 'growing, emerging',
    'nascent': 'new, early-stage',
    'quintessential': 'typical, classic, defining',
    'overarching': 'main, central, broad',
    'underpinning': 'basis, foundation',
    'underpinnings': 'basis, foundations',
    'paradigm-shifting': 'describe what shifted',
  };

  // ─── Tier 3: Flag by density ───────────────────────────────────────
  const TIER3 = [
    'significant', 'significantly', 'innovative', 'innovation',
    'effective', 'effectively', 'dynamic', 'dynamics',
    'scalable', 'scalability', 'compelling', 'unprecedented',
    'exceptional', 'exceptionally', 'remarkable', 'remarkably',
    'sophisticated', 'instrumental',
    'world-class', 'state-of-the-art', 'best-in-class',
  ];

  // Multi-word Tier 3 phrases. Density-gated like single Tier 3 words because
  // these legitimately show up in human crypto/web3/dev writing. Threshold is
  // intentionally lower than single-word Tier 3 (≥2 occurrences of the same
  // phrase) — repeating the same multi-word boilerplate is a stronger AI tell
  // than re-using "significant."
  const TIER3_PHRASES = [
    /\bemerging\s+(?:sector|space|category|industry)\b/gi,
    /\bthe\s+integration\s+of\b/gi,
    /\bthe\s+intersection\s+of\b/gi,
    /\bcommunity-?driven\b/gi,
    /\blong-?term\s+sustainability\b/gi,
    /\buser\s+engagement\b/gi,
    /\bdecentralized\s+compute\b/gi,
    /\b(?:sustainable\s+)?reward\s+emissions?\b/gi,
    /\btokenized\s+incentive\s+structures?\b/gi,
    /\bdesigned\s+for\s+long-?term\b/gi,
  ];

  // O(1) lookup from any token form (hyphenated or dashless) to its canonical
  // Tier 3 word. Counting originally did nested-loop word matching which was
  // O(tokens × TIER3) — slow on long pastes.
  const TIER3_LOOKUP = new Map();
  for (const word of TIER3) {
    TIER3_LOOKUP.set(word, word);
    const dashless = word.replace(/-/g, '');
    if (dashless !== word) TIER3_LOOKUP.set(dashless, word);
  }

  // Per-category score weights. Applied to distinct (deduplicated) issues so
  // the score reflects the same signals the user sees in the issue list.
  // Non-uniform on purpose: critical rules like cutoff disclaimers (×10) and
  // chatbot artifacts (×8) weigh more than vague attributions (×5), even
  // though all three are tagged `critical`.
  const ISSUE_WEIGHTS = {
    tier1: 5,
    tier2: 3,
    tier3: 2,
    transition: 2,
    chatbot: 8,
    sycophantic: 8,
    filler: 2,
    'generic-conclusion': 3,
    'lets-construction': 2,
    'reasoning-artifact': 6,
    'acknowledgment-loop': 3,
    'significance-inflation': 4,
    'vague-attribution': 5,
    'hollow-intensifier': 2,
    'emotional-flatline': 2,
    'novelty-inflation': 3,
    'cutoff-disclaimer': 10,
    'template-phrase': 3,
    'false-concession': 2,
    'rhetorical-question': 2,
    'confidence-calibration': 2,
    'em-dash': 4,
    uniformity: 5,
    formatting: 3,
    'tier3-phrase': 3,
    // Structural / cluster signals are deliberately weighted high. Unlike
    // single-vocabulary hits they're near-dispositive on social-length
    // posts (a 15-hashtag block, a 6-item bullet-NP list, three distinct
    // crypto-shill phrases stacked) and would otherwise be suppressed by
    // the log2(words/50) length divisor on short pastes.
    'tier3-phrase-cluster': 12,
    'hashtag-stuff': 12,
    'bullet-np-list': 10,
    'hedge-stack': 6,
    'future-narrative': 12,
    'real-actual-inflation': 5,
    // Social endorsement / CTA closer. Weighted like formulaic-opener: a
    // strong single-hit social tell that the length divisor would
    // otherwise wash out on a short LinkedIn-length post.
    'social-cta-closer': 8,
    'formulaic-opener': 8,
    'title-case-header': 4,
    'parenthetical-hedge': 3,
    'smart-punct-signature': 6,
    'punct-distribution': 6,
    'fnword-trigram-entropy': 5,
    'cross-para-burstiness': 5,
    'normalization-flag': 9,
    // Vocabulary-diversity signal (type-token ratio). Weighted modestly
    // because the threshold (>=200 tokens AND TTR<0.4) is conservative;
    // it stacks with structural signals to push borderline scores up.
    'low-ttr': 3,
    // AI-tool fingerprints. Weighted higher than statistical patterns
    // because each is a near-definitive single-hit signal — the AI tool
    // literally left its mark in the text. citation-markup ranks highest
    // (smoking gun: the literal internal markup of ChatGPT/Grok/etc.),
    // UTM tracking second (auto-appended by the tool to URLs it writes),
    // placeholders third (strong but humans use bracketed slots in
    // templates legitimately and forget them — still a publishing bug
    // but slightly less definitive AI evidence).
    'ai-placeholder': 10,
    'ai-citation-markup': 15,
    'ai-utm-source': 12,
  };

  // ─── Transition phrases ────────────────────────────────────────────
  const TRANSITIONS = [
    /\bmoreover\b/gi,
    /\bfurthermore\b/gi,
    /\badditionally\b/gi,
    /\bin\s+today'?s\b/gi,
    /\bin\s+an\s+era\s+where\b/gi,
    /\bit'?s\s+worth\s+noting\s+that\b/gi,
    /\bnotably\b/gi,
    /\bin\s+conclusion\b/gi,
    /\bin\s+summary\b/gi,
    /\bto\s+summarize\b/gi,
    /\bwhen\s+it\s+comes\s+to\b/gi,
    /\bat\s+the\s+end\s+of\s+the\s+day\b/gi,
    /\bthat\s+(?:being\s+)?said\b/gi,
  ];

  // ─── Chatbot artifacts ─────────────────────────────────────────────
  const CHATBOT_ARTIFACTS = [
    /\bi\s+hope\s+this\s+helps\b/gi,
    /\bcertainly!\b/gi,
    /\babsolutely!\b/gi,
    /\bgreat\s+question!\b/gi,
    /\bexcellent\s+point!\b/gi,
    /\bfeel\s+free\s+to\s+reach\s+out\b/gi,
    /\blet\s+me\s+know\s+if\s+you\s+need\s+anything\b/gi,
    /\bin\s+this\s+article,?\s+we\s+will\s+explore\b/gi,
    /\blet'?s\s+dive\s+in!?\b/gi,
  ];

  // ─── Sycophantic tone ──────────────────────────────────────────────
  const SYCOPHANTIC = [
    /\byou'?re\s+absolutely\s+right\b/gi,
    /\bthat'?s\s+a\s+really\s+insightful\b/gi,
    /\bthat'?s\s+a\s+great\s+question\b/gi,
    /\bexcellent\s+question\b/gi,
  ];

  // ─── Filler phrases ────────────────────────────────────────────────
  const FILLERS = [
    /\bit\s+is\s+important\s+to\s+note\s+that\b/gi,
    /\bin\s+terms\s+of\b/gi,
    /\bthe\s+reality\s+is\s+that\b/gi,
    /\bit'?s\s+important\s+to\s+note\s+that\b/gi,
  ];

  // ─── Generic conclusions ───────────────────────────────────────────
  const GENERIC_CONCLUSIONS = [
    /\bthe\s+future\s+looks\s+bright\b/gi,
    /\bonly\s+time\s+will\s+tell\b/gi,
    /\bone\s+thing\s+is\s+certain\b/gi,
    /\bas\s+we\s+move\s+forward\b/gi,
  ];

  // ─── "Let's" constructions ─────────────────────────────────────────
  const LETS_PATTERNS = [
    /\blet'?s\s+explore\b/gi,
    /\blet'?s\s+take\s+a\s+look\b/gi,
    /\blet'?s\s+break\s+this\s+down\b/gi,
    /\blet'?s\s+examine\b/gi,
    /\blet'?s\s+(?:consider|discuss|delve|unpack|walk\s+through)\b/gi,
  ];

  // ─── Reasoning chain artifacts ─────────────────────────────────────
  const REASONING_ARTIFACTS = [
    /\blet\s+me\s+think\s+step\s+by\s+step\b/gi,
    /\bbreaking\s+this\s+down\b/gi,
    /\bto\s+approach\s+this\s+systematically\b/gi,
    /\bhere'?s\s+my\s+thought\s+process\b/gi,
    /\bfirst,?\s+let'?s\s+consider\b/gi,
    /\bworking\s+through\s+this\s+logically\b/gi,
  ];

  // ─── Acknowledgment loops ──────────────────────────────────────────
  const ACKNOWLEDGMENT_LOOPS = [
    /\byou'?re\s+asking\s+about\b/gi,
    /\bthe\s+question\s+of\s+whether\b/gi,
    /\bto\s+answer\s+your\s+question\b/gi,
  ];

  // ─── Significance inflation ────────────────────────────────────────
  const SIGNIFICANCE_INFLATION = [
    /\bmarking\s+a\s+(?:pivotal|significant|important)\s+moment\b/gi,
    /\ba\s+watershed\s+moment\s+for\b/gi,
    /\bin\s+the\s+evolution\s+of\b/gi,
    /\ba\s+(?:pivotal|defining)\s+moment\s+in\b/gi,
  ];

  // ─── Vague attributions ────────────────────────────────────────────
  const VAGUE_ATTRIBUTIONS = [
    /\bexperts\s+(?:believe|say|suggest|agree)\b/gi,
    /\bstudies\s+(?:show|suggest|indicate)\b/gi,
    /\bresearch\s+(?:shows|suggests|indicates)\b/gi,
    /\bindustry\s+leaders\s+(?:agree|believe|say)\b/gi,
  ];

  // ─── Hollow intensifiers ──────────────────────────────────────────
  const HOLLOW_INTENSIFIERS = [
    /\bgenuine(?:ly)?\b/gi,
    /\btruly\b/gi,
    /\bquite\s+frankly\b/gi,
    /\bto\s+be\s+honest\b/gi,
    /\blet'?s\s+be\s+clear\b/gi,
  ];

  // ─── Emotional flatline ────────────────────────────────────────────
  // The "interesting (part|thing|aspect|piece)" family is matched in two
  // shapes: (1) "the most interesting X" inline (the canonical AI list
  // intro), and (2) bare "Interesting X:" used as a section-header opener,
  // which is the section-break variant that slipped past v3.3.x.
  const EMOTIONAL_FLATLINE = [
    /\bwhat\s+surprised\s+me\s+most\b/gi,
    /\bi\s+was\s+fascinated\s+to\b/gi,
    /\bwhat\s+struck\s+me\s+was\b/gi,
    /\bi\s+was\s+excited\s+to\s+learn\b/gi,
    /\bthe\s+most\s+interesting\s+(?:part|thing|aspect|piece)\b/gi,
    // Multiline flag (/m) so `^` matches at every line start, including
    // position 0 of a pasted text that has no leading newline. The earlier
    // `(?:^|\n)` form silently missed bare openers at the very start of
    // input — caught by silent-failure audit 2026-05-16.
    /^\s*interesting\s+(?:part|thing|aspect|piece)(?:\s+of\s+(?:the\s+)?\w+)?\s*:/gim,
  ];

  // ─── Novelty inflation ─────────────────────────────────────────────
  const NOVELTY_INFLATION = [
    /\bthe\s+failure\s+mode\s+nobody'?s?\s+naming\b/gi,
    /\ba\s+problem\s+nobody\s+talks\s+about\b/gi,
    /\bthe\s+insight\s+everyone'?s?\s+missing\b/gi,
    /\bwhat\s+nobody\s+tells\s+you\b/gi,
  ];

  // ─── Cutoff disclaimers ────────────────────────────────────────────
  // Includes the canonical LLM self-identification phrases — these are
  // near-dispositive on their own (real humans don't write "as an AI
  // language model" in first person). Patterns cover the major model
  // families' default disclaimer language.
  const CUTOFF_DISCLAIMERS = [
    /\bas\s+of\s+my\s+last\s+update\b/gi,
    /\bas\s+of\s+my\s+(?:knowledge\s+)?(?:cut-?off|last\s+training)\b/gi,
    /\bi\s+don'?t\s+have\s+access\s+to\s+real-?time\s+(?:data|information)\b/gi,
    /\bbased\s+on\s+available\s+information\b/gi,
    /\bas\s+an?\s+(?:ai|artificial\s+intelligence|large\s+language|ai\s+language)\s+(?:language\s+)?model\b/gi,
    /\bi\s+(?:am|'m)\s+an?\s+(?:ai|artificial\s+intelligence|large\s+language)\s+(?:assistant|model)?\b/gi,
    /\bi\s+cannot\s+(?:provide|give|offer)\s+(?:legal|medical|financial|professional)\s+advice\b/gi,
    /\bmy\s+training\s+data\s+(?:only\s+)?(?:goes\s+up\s+to|extends\s+to|ends\s+(?:in|at))\b/gi,
  ];

  // ─── AI-tool fingerprints ──────────────────────────────────────────
  // Three near-definitive AI-origin signals adapted from
  // Aboudjem/humanizer-skill P33-P35 (see docs/competitive/audits/
  // 2026-05-17-aboudjem-humanizer-skill.md). Unlike the statistical
  // patterns above, single hit on any of these is strong evidence —
  // the AI tool literally left its fingerprint in the text.

  // Unfilled slot-fill placeholders. Catches the canonical "[Your Name]"
  // family plus dated stubs and HTML/MD comments with placeholder verbs.
  const AI_PLACEHOLDERS = [
    // Directive stubs ("[Your Name]", "[INSERT SOURCE URL]",
    // "[Describe the specific section]") — verb-led, the user was
    // told to fill in.
    /\[(?:Your|Insert|Add|Enter|Describe|Specify|Choose|Pick)[^\]\n]{1,80}\]/gi,
    // Noun-only template variables common in AI-generated email or
    // letter boilerplate. Match the bare noun OR noun + qualifier.
    // Conservative list: only nouns that almost never appear as
    // bracketed real content (citation refs, code identifiers, etc.
    // are excluded because they typically contain dots, slashes,
    // hyphens, or version numbers).
    /\[(?:Recipient|Sender|Topic|Subject|Salutation|Closing|Position|Department|Project Name|Company Name|Date)(?:\s+[^\]\n]{0,60})?\]/gi,
    // All-caps directive forms ("[INSERT X]", "[FILL IN]") — the
    // uppercase tells you it's a slot, not real content.
    /\[(?:INSERT|FILL\s+IN|ADD|TODO|TBD|PLACEHOLDER)[^\]\n]{0,80}\]/g,
    // Date stubs.
    /\b(?:19|20)\d{2}-XX-XX\b/g,
    /\bXX\/XX\/(?:19|20)\d{2}\b/g,
    // HTML/Markdown comment placeholders with placeholder verbs.
    /<!--\s*(?:add|fill\s+in|insert|todo|placeholder)[^>]{0,120}-->/gi,
  ];

  // Chatbot citation/markup tokens that leak through copy-paste.
  // `citeturn0search0` / `citeturn0news5` from ChatGPT, contentReference
  // tokens, oai_citation, attached_file references, grok_card markers.
  // Each is a near-definitive signature of a specific tool.
  const AI_CITATION_MARKUP = [
    /\bcite(?:turn|news|search|navigation)\d+(?:search|turn|news|navigation)\d+/gi,
    /contentReference\s*\[oaicite:[^\]]+\]\s*\{[^}]*\}/gi,
    /\boai_citation\b/gi,
    /\[attached_file:\d+\]/gi,
    /\bgrok_card\b/gi,
  ];

  // UTM/tracking parameters auto-appended by AI tools to URLs they
  // generate. Survives copy-paste even when nothing else does.
  const AI_UTM_SOURCE = [
    /[?&]utm_source=(?:chatgpt|openai|copilot|claude|grok|gemini|perplexity)(?:\.com|\.ai)?\b/gi,
    /[?&]referrer=(?:chatgpt|copilot|grok|claude|gemini|perplexity)\.(?:com|ai)\b/gi,
  ];

  // ─── Template phrases ──────────────────────────────────────────────
  const TEMPLATE_PHRASES = [
    /\ba\s+\w+\s+step\s+(?:towards?|forward\s+for)\b/gi,
    /\bwhether\s+you'?re\s+\w+\s+or\s+\w+/gi,
    /\bi\s+recently\s+had\s+the\s+pleasure\s+of\b/gi,
  ];

  // ─── False concession ──────────────────────────────────────────────
  const FALSE_CONCESSION = [
    /\bwhile\s+\w+\s+is\s+impressive\b/gi,
    /\balthough\s+\w+\s+has\s+made\s+strides\b/gi,
    /\bdespite\s+\w+\s+challenges?\b/gi,
  ];

  // ─── Rhetorical question openers ───────────────────────────────────
  const RHETORICAL_QUESTIONS = [
    /\bbut\s+what\s+does\s+this\s+mean\s+for\b/gi,
    /\bso\s+why\s+should\s+you\s+care\b/gi,
    /\bwhat'?s\s+next\?\s*/gi,
  ];

  // ─── Hedge-stacked predictions ─────────────────────────────────────
  // Stacks a modal with a hedge adverb: "could potentially create new
  // opportunities", "may eventually unlock value." Either word alone is
  // fine; the stack is the tell.
  const HEDGE_STACK = [
    /\b(?:could|may|might)\s+(?:\w+\s+){0,2}(?:potentially|eventually|ultimately|possibly|conceivably)\b/gi,
    /\b(?:potentially|eventually|ultimately)\s+(?:could|may|might)\b/gi,
  ];

  // ─── Generic future-narrative closers ──────────────────────────────
  // The "may become one of the most important narratives" template — vague
  // future significance with no falsifiable claim. Covers narratives /
  // stories / trends / themes / chapters / movements.
  const FUTURE_NARRATIVE = [
    /\b(?:may|could|will|is\s+(?:poised|set)\s+to)\s+become\s+(?:one\s+of\s+)?(?:the\s+)?(?:most\s+)?\w+\s+(?:narratives?|stories|developments?|trends?|movements?|chapters?|themes?|forces?)\b/gi,
    /\bone\s+of\s+the\s+most\s+important\s+(?:narratives?|stories|trends?|themes?)\s+of\s+the\s+(?:next|coming)\s+\w+\b/gi,
  ];

  // ─── "Real/actual" adjective inflation ─────────────────────────────
  // "Real on-chain tokenomics", "actual reward sustainability" — using
  // real/actual/genuine/true as an empty intensifier on an abstract noun
  // to imply the rest of the field is fake/superficial.
  const REAL_ACTUAL_INFLATION = [
    /\b(?:real|actual|genuine|true)\s+(?:on-?chain\s+)?(?:tokenomics|economics|utility|adoption|sustainability|impact|revenue|fundamentals|demand|value|innovation|traction)\b/gi,
  ];

  // ─── Formulaic openers ─────────────────────────────────────────────
  // The "In the rapidly evolving world of X, Y has emerged as..." family
  // — LLM-default essay openers.
  const FORMULAIC_OPENERS = [
    /\bin\s+the\s+(?:rapidly\s+|ever-?\s*)?(?:evolving|changing|expanding|growing|shifting)\s+(?:world|landscape|realm|space|field|domain|era)\s+of\b/gi,
    /\bin\s+(?:an?|the)\s+(?:digital\s+)?age\s+(?:where|of)\b/gi,
    /\bas\s+(?:we|the\s+world|society|industries?)\s+(?:continue|move|navigate|enter)\s+(?:to\s+)?(?:evolve|forward|into|through)\b/gi,
    // "has emerged as a leader/force/category" — gated to the inflated
    // nouns that signal pseudo-significance, since bare "has emerged as
    // a" matches normal English ("Rust has emerged as a serious systems
    // language"). Same gating for "has become increasingly".
    /\bhas\s+emerged\s+as\s+(?:a|the|one\s+of)\s+(?:leading|key|major|critical|essential|fundamental|pivotal|prominent|dominant|important)\s+\w+/gi,
    /\bhas\s+become\s+increasingly\s+(?:important|critical|popular|relevant|prominent|essential)\b/gi,
  ];

  // ─── Title Case Section Headers in non-technical prose ─────────────
  // "Strategic Negotiations And Key Partnerships" — every content word
  // capitalized. Acceptable in API docs, ML papers, news headlines. Tell
  // in marketing/personal/blog prose. Gated to "personal" / "marketing"
  // context modes (technical mode skips this check).
  const TITLE_CASE_HEADER = /^([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|and|or|of|the|in|for|to|a|an))+\s+[A-Z][a-z]+)\s*$/gm;

  // ─── Parenthetical hedging asides ──────────────────────────────────
  // "(and increasingly, X)", "(or more precisely, Y)", "(though to be
  // fair, Z)" — pseudo-aside that adds no information but performs
  // thoughtfulness. Different from genuine human parentheticals which
  // tend to be tangents or clarifications, not hedges.
  const PARENTHETICAL_HEDGE = [
    /\(\s*(?:and\s+)?(?:increasingly|notably|importantly|crucially|interestingly|perhaps)[,]?\s+[^)]{3,60}\)/gi,
    /\(\s*or\s+more\s+(?:precisely|accurately|specifically)[,]?\s+[^)]{3,60}\)/gi,
    /\(\s*though\s+to\s+be\s+fair[,]?\s+[^)]{3,60}\)/gi,
    /\(\s*at\s+least\s+(?:in\s+)?(?:theory|principle|part)[,]?\s+[^)]{0,60}\)/gi,
  ];

  // ─── Confidence calibration ────────────────────────────────────────
  const CONFIDENCE_CALIBRATION = [
    /\binterestingly\b/gi,
    /\bsurprisingly\b/gi,
    /\bimportantly\b/gi,
    /\bsignificantly\b/gi,
    /\bcertainly\b/gi,
    /\bundoubtedly\b/gi,
    /\bwithout\s+a\s+doubt\b/gi,
  ];

  // ─── Social endorsement / CTA closers ──────────────────────────────
  // The curatorial sign-off LLMs append to LinkedIn / X posts that share
  // or recommend something — usually a colon teeing up a link. Distinct
  // from the bare "worth reading" word-table entry (a single weak word)
  // and from infomercial hooks (mid-flow teasers): this is the
  // demonstrative-anchored endorsement — "THIS one is worth your time:",
  // "do yourself a favor and read this", "thank me later" — that performs
  // a recommendation without giving the reader a reason to click.
  //
  // Precision-first: each pattern carries an anchor so it stays off the
  // literal-verb prose a human writes. The demonstrative object ("read
  // THIS", not "read the runbook"), the trailing-terminal lookahead on
  // "miss this" / "bookmark this" (the closing-line shape, not "miss this
  // meeting" / "bookmark this page"), and the sentence-initial lookbehind
  // on "thank me later" / "save this for later" (the imperative CTA, not
  // "she will thank me later") all exist to suppress false positives on
  // ordinary instructional/conversational text. Apostrophe classes admit
  // the curly ' (U+2019) because LinkedIn / Word / macOS auto-curl it —
  // the straight-only form would miss the canonical "you won't" closer.
  const SOCIAL_CTA_CLOSER = [
    /\bthis\s+one['’]?s?\s+(?:is\s+)?(?:well\s+|totally\s+|absolutely\s+|definitely\s+|really\s+|truly\s+|easily\s+|more\s+than\s+)?worth\s+(?:your\s+time|the\s+read|a\s+read|every\s+(?:minute|second)|reading|watching|a\s+listen|a\s+watch|a\s+look|it)\b/gi,
    /\bthis\s+one['’]?s?\s+(?:is\s+)?a\s+must[-\s]?(?:read|watch|listen|see)\b/gi,
    /\b(?:highly|strongly|can['’]?t|cannot)\s+recommend\w*\s+(?:giving\s+)?(?:this|it)\s+(?:one\s+)?a\s+(?:read|listen|watch|look|go)\b/gi,
    /\bdo\s+yourself\s+a\s+favou?r\s+and\s+(?:read|watch|check\s+out)\s+(?:this|it)\b/gi,
    /\byou\s+(?:really\s+)?(?:won['’]?t|do\s*n['’]?t|will\s+not|do\s+not)\s+want\s+to\s+miss\s+this(?:\s+one)?(?=\s*(?:[:.!\n]|$))/gi,
    /(?<=^|[,.!?:\n]\s{0,4})(?:you\s+can\s+)?thank\s+me\s+later\b/gim,
    /(?<=^|[.!?:\n]\s{0,4})save\s+this\s+(?:one\s+)?for\s+later\b/gim,
    /\bbookmark\s+this(?:\s+(?:one|post|thread))?(?=\s*(?:[:.!\n]|$))/gi,
    /\bdo\s*n['’]?t\s+sleep\s+on\s+this\b/gi,
    /\btrust\s+me,?\s+(?:on\s+this|you['’]?ll)\b/gi,
  ];

  // ═══ Helpers ═══════════════════════════════════════════════════════

  function tokenize(text) {
    return text.toLowerCase().match(/[\w'-]+/g) || [];
  }

  function countWords(text) {
    return (text.match(/\S+/g) || []).length;
  }

  function getParagraphs(text) {
    return text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  }

  function getSentences(text) {
    return text.split(/[.!?]+/).filter(s => s.trim().length > 5);
  }

  function matchPatterns(text, patterns, category, severity) {
    const issues = [];
    for (const pat of patterns) {
      const regex = new RegExp(pat.source, pat.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        issues.push({
          type: category,
          text: match[0],
          index: match.index,
          severity,
          suggestion: null,
        });
      }
    }
    return issues;
  }

  // ═══ Main analysis ═════════════════════════════════════════════════

  // Upper bound for one scan. Above this we bail rather than running all
  // regex passes over a huge buffer — protects page perf on pasted novels.
  const MAX_WORDS = 10000;

  // V2 contract defaults so early-exit paths (Empty/tooShort/tooLong)
  // still return the same field shape a v2 consumer expects. Without
  // this, `result.document_classification === 'AI_ONLY'` is `undefined`
  // on edge inputs and fails open.
  // UNSCORED is returned on empty / too-short / too-long inputs where
  // we declined to score. Distinct from HUMAN_ONLY (which is a positive
  // classification) so a caller can't mistake a refused scan for a
  // confident human verdict — a 50k-word LLM-generated document is
  // not "human", it's just outside our scoring window.
  function buildV2Defaults(classification, confidence) {
    const probs = classification === 'HUMAN_ONLY'
      ? { human: 1, mixed: 0, ai: 0 }
      : classification === 'AI_ONLY'
        ? { human: 0, mixed: 0, ai: 1 }
        : { human: 0.333, mixed: 0.334, ai: 0.333 };
    return {
      document_classification: classification,
      class_probabilities: probs,
      confidence_category: confidence,
      highlight_sentence_for_ai: [],
    };
  }

  function analyzeText(text, options = {}) {
    if (!text || text.trim().length === 0) {
      return { ...buildV2Defaults('UNSCORED', 'low'), score: 0, label: 'Empty', issues: [], stats: {}, tooShort: true };
    }

    // Context mode gates rules that are noisy in technical writing. Modes:
    //   'general' (default) — full ruleset
    //   'technical' — skip title-case headers, formulaic openers gated to
    //                 prose-only structures; lower em-dash + formatting weights
    //   'marketing' — full ruleset + boost on formulaic-opener / future-narrative
    //   'personal'  — full ruleset, normal weights
    // Mode is purely a soft gate; nothing is silently suppressed without
    // being reflected in stats.contextMode for transparency.
    // Mode validation: an unknown string (e.g. typo "tecnical") would
    // otherwise silently downgrade to general-mode behavior. Coerce to
    // 'general' and surface the original value in stats for traceability.
    const VALID_CONTEXT_MODES = new Set(['general', 'technical', 'marketing', 'personal']);
    const requestedMode = options.contextMode || 'general';
    const contextMode = VALID_CONTEXT_MODES.has(requestedMode) ? requestedMode : 'general';
    const contextModeFallback = requestedMode !== contextMode ? requestedMode : null;

    // Pre-pass: strip Markdown blockquotes before scoring. A human
    // reacting to AI text by quoting it shouldn't have the quoted block
    // counted against their own writing. Requires ≥2 consecutive `> `
    // lines to count as a blockquote — single-line `> ls -la` shell
    // prompts in technical docs stay in the text.
    let quotedLines = 0;
    const rawLines = text.split(/\r?\n/);
    const isQuote = rawLines.map((l) => /^\s*>\s/.test(l));
    const stripIdx = new Set();
    for (let i = 0; i < rawLines.length; i++) {
      if (isQuote[i] && ((isQuote[i - 1] && i > 0) || isQuote[i + 1])) {
        stripIdx.add(i);
        quotedLines++;
      }
    }
    text = rawLines.filter((_, i) => !stripIdx.has(i)).join('\n');

    // Pre-pass: strip bypass-trick chars before pattern matching so
    // "delve" with a Cyrillic 'е' still hits Tier 1. Original text is
    // preserved so reported `match.index` values remain visually accurate.
    const norm = normalizeText(text);
    text = norm.text;

    const wordCount = countWords(text);
    if (wordCount < 10) {
      return { ...buildV2Defaults('UNSCORED', 'low'), score: 0, label: 'Too short', issues: [], stats: { wordCount, contextMode, contextModeFallback }, tooShort: true };
    }
    if (wordCount > MAX_WORDS) {
      return {
        ...buildV2Defaults('UNSCORED', 'low'),
        score: 0,
        label: 'Text too long',
        issues: [],
        stats: { wordCount, contextMode, contextModeFallback },
        tooLong: true,
      };
    }

    const tokens = tokenize(text);
    const paragraphs = getParagraphs(text);
    const sentences = getSentences(text);
    const issues = [];
    let rawScore = 0;

    // ── 1. Tier 1 words ──────────────────────────────────────────
    const tier1Found = new Set();
    for (const token of tokens) {
      if (TIER1[token] && !tier1Found.has(token)) {
        tier1Found.add(token);
        issues.push({
          type: 'tier1',
          text: token,
          severity: 'high',
          suggestion: TIER1[token],
        });
      }
    }

    // Tier 1 multi-word phrases. Adds each distinct phrase (lowercased) to
    // `tier1Found` so the same phrase hit multiple times only produces one
    // issue — matches the downstream dedup behavior.
    for (const phrase of TIER1_PHRASES) {
      const regex = new RegExp(phrase.pattern.source, phrase.pattern.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        const lower = match[0].toLowerCase();
        if (tier1Found.has(lower)) continue;
        tier1Found.add(lower);
        issues.push({
          type: 'tier1',
          text: match[0],
          severity: 'high',
          suggestion: phrase.replace,
        });
      }
    }

    // ── 2. Tier 2 clusters ───────────────────────────────────────
    let tier2Clusters = 0;
    for (const para of paragraphs) {
      const paraTokens = tokenize(para);
      const found = [];
      for (const token of paraTokens) {
        if (TIER2[token] && !found.includes(token)) {
          found.push(token);
        }
      }
      if (found.length >= 2) {
        tier2Clusters++;
        for (const word of found) {
          issues.push({
            type: 'tier2',
            text: word,
            severity: 'medium',
            suggestion: TIER2[word],
          });
        }
      }
    }

    // ── 3. Tier 3 density ────────────────────────────────────────
    const tier3Counts = {};
    for (const token of tokens) {
      const canonical = TIER3_LOOKUP.get(token);
      if (canonical) tier3Counts[canonical] = (tier3Counts[canonical] || 0) + 1;
    }
    // Flag at 3% of word count, but never below 3 occurrences. Previous
    // floor of 1 meant a 50-word text with one "significant" got flagged
    // as Tier 3 overuse, which was noise.
    const densityThreshold = Math.max(3, Math.floor(wordCount * 0.03));
    let tier3Flags = 0;
    for (const [word, count] of Object.entries(tier3Counts)) {
      if (count >= densityThreshold) {
        tier3Flags++;
        issues.push({
          type: 'tier3',
          text: `"${word}" x${count}`,
          severity: 'low',
          suggestion: `Overused (${count} times in ${wordCount} words)`,
        });
      }
    }

    // ── 4–21. Pattern categories ─────────────────────────────────
    issues.push(...matchPatterns(text, TRANSITIONS, 'transition', 'medium'));
    issues.push(...matchPatterns(text, CHATBOT_ARTIFACTS, 'chatbot', 'critical'));
    issues.push(...matchPatterns(text, SYCOPHANTIC, 'sycophantic', 'critical'));
    issues.push(...matchPatterns(text, FILLERS, 'filler', 'medium'));
    issues.push(...matchPatterns(text, GENERIC_CONCLUSIONS, 'generic-conclusion', 'medium'));
    issues.push(...matchPatterns(text, LETS_PATTERNS, 'lets-construction', 'medium'));
    issues.push(...matchPatterns(text, REASONING_ARTIFACTS, 'reasoning-artifact', 'critical'));
    issues.push(...matchPatterns(text, ACKNOWLEDGMENT_LOOPS, 'acknowledgment-loop', 'medium'));
    issues.push(...matchPatterns(text, SIGNIFICANCE_INFLATION, 'significance-inflation', 'high'));
    issues.push(...matchPatterns(text, VAGUE_ATTRIBUTIONS, 'vague-attribution', 'critical'));
    issues.push(...matchPatterns(text, HOLLOW_INTENSIFIERS, 'hollow-intensifier', 'medium'));
    issues.push(...matchPatterns(text, EMOTIONAL_FLATLINE, 'emotional-flatline', 'low'));
    issues.push(...matchPatterns(text, NOVELTY_INFLATION, 'novelty-inflation', 'medium'));
    issues.push(...matchPatterns(text, CUTOFF_DISCLAIMERS, 'cutoff-disclaimer', 'critical'));
    issues.push(...matchPatterns(text, AI_PLACEHOLDERS, 'ai-placeholder', 'critical'));
    issues.push(...matchPatterns(text, AI_CITATION_MARKUP, 'ai-citation-markup', 'critical'));
    issues.push(...matchPatterns(text, AI_UTM_SOURCE, 'ai-utm-source', 'critical'));
    issues.push(...matchPatterns(text, TEMPLATE_PHRASES, 'template-phrase', 'high'));
    issues.push(...matchPatterns(text, FALSE_CONCESSION, 'false-concession', 'medium'));
    issues.push(...matchPatterns(text, RHETORICAL_QUESTIONS, 'rhetorical-question', 'medium'));
    issues.push(...matchPatterns(text, HEDGE_STACK, 'hedge-stack', 'high'));
    issues.push(...matchPatterns(text, FUTURE_NARRATIVE, 'future-narrative', 'high'));
    issues.push(...matchPatterns(text, REAL_ACTUAL_INFLATION, 'real-actual-inflation', 'medium'));
    issues.push(...matchPatterns(text, SOCIAL_CTA_CLOSER, 'social-cta-closer', 'high'));

    // ── Tier 1 v2: formulaic openers + parenthetical hedges ──────────
    issues.push(...matchPatterns(text, FORMULAIC_OPENERS, 'formulaic-opener', 'high'));
    issues.push(...matchPatterns(text, PARENTHETICAL_HEDGE, 'parenthetical-hedge', 'medium'));

    // Title-case headers — gated to marketing/personal/general modes
    // (technical mode legitimately uses Title Case section headers).
    if (contextMode !== 'technical') {
      const titleHits = matchPatterns(text, [TITLE_CASE_HEADER], 'title-case-header', 'medium');
      // Drop matches that look like proper-noun titles (single line, all
      // tokens capitalized incl. function words) — that's headline style,
      // not the AI-section-header tell which has mid-sentence "And".
      const filtered = titleHits.filter((h) => {
        const tokens = h.text.split(/\s+/);
        return tokens.length >= 4 && /\b(?:And|Or|Of|The|In|For|To|A|An)\b/.test(h.text);
      });
      issues.push(...filtered);
    }

    // ── Normalization-trigger flag ───────────────────────────────────
    // ZWSPs or homoglyphs in pasted prose are near-dispositive: humans
    // don't insert these into their own writing. Single roleplay marker
    // can be a false positive on Markdown emphasis (filtered to multi-
    // word inner already), so requires ≥2.
    if (norm.flags.zeroWidth > 0 || norm.flags.homoglyph >= 2) {
      issues.push({
        type: 'normalization-flag',
        text: `${norm.flags.zeroWidth} zero-width + ${norm.flags.homoglyph} homoglyph swap${norm.flags.homoglyph === 1 ? '' : 's'}`,
        severity: 'critical',
        suggestion: 'Text contains invisible/lookalike chars typical of AI-humanizer bypass tools. Re-type from your own keyboard.',
      });
    }
    if (norm.flags.roleplay >= 2) {
      issues.push({
        type: 'normalization-flag',
        text: `${norm.flags.roleplay} *roleplay-action* markers stripped`,
        severity: 'high',
        suggestion: 'Paired *action* markers are a chat-model artifact.',
      });
    }

    // ── Smart-punctuation co-occurrence signature ────────────────────
    // Curly quotes + em-dash + Oxford comma all present + zero typos
    // (no double-spaces, no missing apostrophes in common contractions)
    // is a near-dispositive paste-from-LLM signature: humans typing
    // directly into a textarea don't produce all four. Standalone any of
    // these is meaningless — co-occurrence is the signal.
    {
      const hasCurly = /[“”‘’]/.test(text);
      const hasEmDash = /—/.test(text);
      const oxfordHit = text.match(/\b\w+,\s+\w+,\s+and\s+\w+/g);
      const hasOxford = (oxfordHit?.length || 0) >= 1;
      const doubleSpaces = (text.match(/[^.!?]  +/g) || []).length;
      const missingApos = /\b(?:dont|wont|cant|isnt|wasnt|shouldnt|wouldnt|couldnt|youre|theyre|its\s+a\s+\w+ing)\b/i.test(text);
      const clean = doubleSpaces === 0 && !missingApos;
      const signals = [hasCurly, hasEmDash, hasOxford, clean].filter(Boolean).length;
      if (signals >= 4 && wordCount >= 80) {
        issues.push({
          type: 'smart-punct-signature',
          text: 'curly-quotes + em-dash + Oxford comma + zero typos',
          severity: 'high',
          suggestion: 'Smart-punctuation signature consistent with LLM output. Humans typing into textareas rarely produce all four.',
        });
      }
    }

    // ── Punctuation distribution mode ────────────────────────────────
    // Humans cluster trimodal across paragraphs (some paras heavy, some
    // light, some none). AI converges on a normal distribution. We can't
    // run a real modality test client-side, but we can flag the AI
    // signature: low variance of per-paragraph punctuation density.
    // Requires ≥4 paragraphs to be meaningful.
    if (paragraphs.length >= 4) {
      const densities = paragraphs.map((p) => {
        const words = (p.match(/\S+/g) || []).length;
        if (words < 5) return null;
        const puncts = (p.match(/[,;:—()]/g) || []).length;
        return puncts / words;
      }).filter((d) => d !== null);
      if (densities.length >= 4) {
        const mean = densities.reduce((a, b) => a + b, 0) / densities.length;
        const variance = densities.reduce((s, d) => s + (d - mean) ** 2, 0) / densities.length;
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
        // CV < 0.25 across paragraphs means each paragraph has the same
        // punctuation density — the AI signature. Humans usually swing
        // wider. Threshold derived from stylometry papers (arxiv 2507.00838).
        if (cv < 0.25 && mean >= 0.04) {
          issues.push({
            type: 'punct-distribution',
            text: `Punctuation density uniform across paragraphs (CV=${cv.toFixed(2)})`,
            severity: 'medium',
            suggestion: 'AI text holds punctuation density steady; human writers swing between dense and sparse paragraphs.',
          });
        }
      }
    }

    // ── Function-word trigram entropy ────────────────────────────────
    // POS-trigram entropy is the academic signal; function-word trigram
    // entropy approximates it without a tagger (function words ARE the
    // closed-class POS classes). AI text has lower entropy because LLM
    // sampling collapses onto a narrower set of grammatical templates.
    //
    // Method: extract function-word indicators per sentence, build
    // trigrams over the sequence, compute Shannon entropy. Bins below
    // threshold flag.
    if (wordCount >= 150) {
      const FUNC_WORDS = new Set([
        'the','a','an','and','or','but','of','to','in','on','at','by','for','with',
        'from','as','is','was','are','were','be','been','being','have','has','had',
        'do','does','did','will','would','should','could','may','might','must','can',
        'this','that','these','those','it','its','they','them','their','there','here',
        'we','our','us','i','you','your','he','she','his','her','him','not','no','so',
        'if','then','than','when','where','which','who','what','how','why','because',
      ]);
      const seq = tokens.map((t) => FUNC_WORDS.has(t) ? t : '_').filter((_, i, arr) => arr[i] !== '_' || (i > 0 && arr[i - 1] !== '_'));
      if (seq.length >= 50) {
        const trigrams = {};
        for (let i = 0; i < seq.length - 2; i++) {
          const tg = `${seq[i]}|${seq[i + 1]}|${seq[i + 2]}`;
          trigrams[tg] = (trigrams[tg] || 0) + 1;
        }
        const total = seq.length - 2;
        let entropy = 0;
        for (const c of Object.values(trigrams)) {
          const p = c / total;
          entropy -= p * Math.log2(p);
        }
        // Normalize by log2(distinct trigrams) so entropy ranges roughly
        // 0..1 and threshold is interpretable. Empirical threshold: human
        // prose ~0.85-0.95 normalized, AI prose ~0.70-0.82.
        const distinctCount = Object.keys(trigrams).length;
        const normalized = distinctCount > 1 ? entropy / Math.log2(distinctCount) : 1;
        if (normalized < 0.82 && total >= 50) {
          issues.push({
            type: 'fnword-trigram-entropy',
            text: `Function-word trigram entropy ${normalized.toFixed(2)} (low)`,
            severity: 'medium',
            suggestion: 'Grammatical structure is unusually repetitive. AI sampling collapses onto narrower templates than human writing.',
          });
        }
        // Degenerate case: single distinct trigram repeated across the
        // whole document is the strongest possible AI signal but the
        // normalized fallback returns 1.0 (= "fully human"), inverting
        // the signal. Catch it explicitly.
        if (distinctCount === 1 && total >= 50) {
          issues.push({
            type: 'fnword-trigram-entropy',
            text: 'Single function-word trigram repeated across document',
            severity: 'high',
            suggestion: 'Grammatical structure is fully degenerate — every clause uses the same function-word skeleton.',
          });
        }
      }
    }

    // ── Cross-paragraph burstiness ───────────────────────────────────
    // We already check within-paragraph sentence-length uniformity. AI
    // is also flat ACROSS paragraphs — every paragraph has roughly the
    // same sentence-length variance. Humans vary: terse paras next to
    // discursive paras. Measure variance of CV across paragraphs.
    if (paragraphs.length >= 4) {
      const cvs = paragraphs.map((p) => {
        const sents = getSentences(p);
        if (sents.length < 3) return null;
        const lens = sents.map(countWords);
        const m = lens.reduce((a, b) => a + b, 0) / lens.length;
        if (m === 0) return null;
        const v = lens.reduce((s, l) => s + (l - m) ** 2, 0) / lens.length;
        return Math.sqrt(v) / m;
      }).filter((c) => c !== null);
      if (cvs.length >= 4) {
        const cvMean = cvs.reduce((a, b) => a + b, 0) / cvs.length;
        const cvVar = cvs.reduce((s, c) => s + (c - cvMean) ** 2, 0) / cvs.length;
        const cvStd = Math.sqrt(cvVar);
        // Std-of-CV below 0.08 means every paragraph has roughly the same
        // internal rhythm — AI signature. Human prose typically swings
        // 0.15-0.40 across paragraphs of mixed purpose.
        if (cvStd < 0.08 && cvMean < 0.45) {
          issues.push({
            type: 'cross-para-burstiness',
            text: `Sentence-rhythm uniform across paragraphs (σCV=${cvStd.toFixed(2)})`,
            severity: 'medium',
            suggestion: 'Every paragraph has the same internal rhythm. Humans vary cadence between terse and discursive paragraphs.',
          });
        }
      }
    }

    // ── Tier 3 multi-word phrase density ─────────────────────────
    // Two complementary rules:
    //   (a) Per-phrase density — same gating as single-word Tier 3: each
    //       phrase fine alone, repetition is the tell. Threshold = 2.
    //   (b) Cross-phrase clustering — ≥3 *distinct* boilerplate phrases
    //       in one piece. LLMs varying their own boilerplate often use
    //       each phrase only once but stack 5-10 across the text. The
    //       per-phrase rule misses this; the cluster rule catches it.
    // Track non-overlapping match spans so a longer phrase swallowing a
    // shorter one (e.g., "designed for long-term sustainability" matches
    // both "designed for long-term" AND "long-term sustainability") only
    // contributes one distinct hit. Without dedup the cluster threshold
    // can be reached by a single sentence stacking overlapping regexes.
    const claimedSpans = [];
    function spanOverlaps(start, end) {
      for (const [s, e] of claimedSpans) {
        if (start < e && end > s) return true;
      }
      return false;
    }
    let distinctPhrasesHit = 0;
    for (const phrase of TIER3_PHRASES) {
      const regex = new RegExp(phrase.source, phrase.flags);
      const phraseSpans = [];
      let phraseMatch;
      while ((phraseMatch = regex.exec(text)) !== null) {
        const start = phraseMatch.index;
        const end = start + phraseMatch[0].length;
        if (!spanOverlaps(start, end)) {
          phraseSpans.push([start, end, phraseMatch[0]]);
        }
      }
      if (phraseSpans.length === 0) continue;
      for (const [s, e] of phraseSpans) claimedSpans.push([s, e]);
      distinctPhrasesHit++;
      if (phraseSpans.length >= 2) {
        issues.push({
          type: 'tier3-phrase',
          text: `"${phraseSpans[0][2].toLowerCase()}" x${phraseSpans.length}`,
          severity: 'medium',
          suggestion: `Boilerplate phrase repeated ${phraseSpans.length}× — replace at least one with specifics`,
        });
      }
    }
    if (distinctPhrasesHit >= 3) {
      issues.push({
        type: 'tier3-phrase-cluster',
        text: `${distinctPhrasesHit} distinct boilerplate phrases`,
        severity: 'high',
        suggestion: 'Several stock crypto/web3 phrases stacked in one piece. Rewrite around one specific claim or observation.',
      });
    }

    // ── Hashtag stuffing ─────────────────────────────────────────
    // 6+ hashtags in a single post is rare for thoughtful humans and
    // near-universal for LLM-generated social posts. Counted globally,
    // not per-paragraph, since the trailing hashtag block is the shape
    // we care about.
    // Match #tag at start of text or after any non-word char (whitespace,
    // punctuation, line breaks). URL fragments are already excluded
    // because the char immediately before `#` in a URL path is always
    // a word char (e.g. `example.com/page#section` — `e` before `#`).
    // Earlier char class `[\s\\]` had a literal backslash and silently
    // missed hashtags after sentence punctuation; an interim `[\s]` fix
    // on origin only caught whitespace-preceded tags.
    const hashtagMatches = text.match(/(?:^|\W)#\w[\w-]*/g) || [];
    if (hashtagMatches.length >= 6) {
      issues.push({
        type: 'hashtag-stuff',
        text: `${hashtagMatches.length} hashtags`,
        severity: 'medium',
        suggestion: 'Cut to 2-3 specific tags or none. Long hashtag blocks read as bot output.',
      });
    }

    // ── Bullet list of bare noun phrases ─────────────────────────
    // ≥5 consecutive bullet items that are short (≤6 words) and contain
    // no finite-verb / modal token. Catches the "Stable mining efficiency
    // / Reliable pool connectivity / Optimized RandomX performance ..."
    // shape LLMs default to. Markdown bullets, escaped Markdown bullets,
    // unicode bullets, and dashes are all matched. Numbered lists are
    // excluded — those have a separate "numbered list inflation" rule.
    //
    // Note: verbRe covers auxiliaries and modals ("was", "will", "can",
    // etc.). Regular past-tense verbs ("fixed", "removed") are not
    // matched here; instead, the ≤6-word length gate excludes most
    // real-world changelog lines, which tend to read "fixed the X that
    // was doing Y" (>6 words). Short two-word action items ("* fixed
    // bug") would pass both gates — an acceptable trade-off to avoid
    // false-negative risk from adjectives ending in -ed ("skilled",
    // "advanced") that share the same surface form.
    const lines = text.split(/\r?\n/);
    const bulletRe = /^\s*(?:\*|-|•|\+)\s+(.+)$/;
    const verbRe = /\b(?:is|are|was|were|has|have|had|will|would|should|must|do|does|did|can|could|may|might|am|been|being)\b/i;
    const fenceRe = /^\s*(?:```|~~~)/;
    let run = [];
    let blankStreak = 0;
    let inFence = false;
    function flushRun() {
      if (run.length >= 5) {
        const bareNP = run.filter((it) => {
          const wc = (it.match(/\S+/g) || []).length;
          return wc > 0 && wc <= 6 && !verbRe.test(it);
        });
        if (bareNP.length >= 5 && bareNP.length / run.length >= 0.75) {
          issues.push({
            type: 'bullet-np-list',
            text: `${run.length}-item bullet list of bare noun phrases`,
            severity: 'high',
            suggestion: 'Convert to a prose paragraph or merge items. Long lists of bare adj+noun pairs read as AI scaffolding.',
          });
        }
      }
      run = [];
      blankStreak = 0;
    }
    for (const line of lines) {
      if (fenceRe.test(line)) {
        // Code-fence toggle. Bullets inside fences are CLI flag docs or
        // option dumps, not prose AI scaffolding — flush any prose run
        // we were tracking and skip until the fence closes.
        flushRun();
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = line.match(bulletRe);
      if (m) {
        run.push(m[1].trim());
        blankStreak = 0;
      } else if (line.trim() === '') {
        // A single blank line inside a list is normal Markdown spacing;
        // two or more blank lines break the run, since visually-disjoint
        // bullet sections shouldn't merge into one logical list.
        blankStreak++;
        if (blankStreak >= 2) flushRun();
      } else {
        flushRun();
      }
    }
    flushRun();

    // Confidence calibration is only flagged when it stacks (3+ instances).
    // Gating happens pre-dedup on raw match count, since that signals actual
    // stacking, not just vocabulary use.
    const confIssues = matchPatterns(text, CONFIDENCE_CALIBRATION, 'confidence-calibration', 'low');
    if (confIssues.length >= 3) issues.push(...confIssues);

    // ── 22. Em dash frequency ────────────────────────────────────
    // Match real em dashes, plus `--` only when surrounded by whitespace on at
    // least one side (skips CLI flags like --save-dev and YAML `---` blocks).
    const emDashCount = (text.match(/—|(?<=\s)--(?=\s|$)|(?<=^|\s)--(?=\s)/gm) || []).length;
    const emDashRate = emDashCount / (wordCount / 1000);
    if (emDashRate > 1) {
      issues.push({
        type: 'em-dash',
        text: `${emDashCount} em dashes in ${wordCount} words`,
        severity: 'medium',
        suggestion: 'Replace with commas, periods, or rewrite',
      });
    }

    // ── 23. Sentence length uniformity ───────────────────────────
    if (sentences.length >= 5) {
      const lengths = sentences.map(s => countWords(s));
      const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length;
      const stdDev = Math.sqrt(variance);
      const cv = avg > 0 ? stdDev / avg : 0;

      if (cv < 0.25 && avg > 10) {
        issues.push({
          type: 'uniformity',
          text: `Sentence lengths cluster around ${Math.round(avg)} words (low variation)`,
          severity: 'medium',
          suggestion: 'Mix short punchy sentences with longer flowing ones',
        });
      }
    }

    // ── Type-token ratio (stylometric — vocabulary diversity) ────
    // TTR = distinct word types / total tokens. Human prose at 200+
    // words typically sits around 0.50–0.65 for English; AI prose
    // tends flatter (0.55–0.75 looks normal, but the lower end of the
    // *too-flat* tail at >=200 words is where the signal lives — too
    // FEW unique words for the length). This is the simplest of the
    // four stylometric signals identified in the May 2026 detection-
    // research review (docs/competitive/detection-research.md): no
    // POS tagger required, no model, pure JS.
    //
    // Threshold tuning: flag only when the sample is large enough
    // that low TTR is meaningfully suspicious (>=200 tokens) AND TTR
    // is below 0.40 (very vocabulary-poor). Conservative on purpose;
    // false positives on short or topic-narrow human prose are easy
    // to trigger and would drown out other signals. The detector-
    // research lens flagged TTR as one of four stylometric add-ons;
    // POS-bigram log-odds, function-word z-scores, and sentence-
    // length burstiness are still TODO.
    if (tokens.length >= 200) {
      const unique = new Set(tokens).size;
      const ttr = unique / tokens.length;
      if (ttr < 0.4) {
        issues.push({
          type: 'low-ttr',
          text: `Vocabulary diversity ${(ttr * 100).toFixed(1)}% (${unique} unique / ${tokens.length} tokens)`,
          severity: 'low',
          suggestion: 'Text reuses a narrow word set. Vary nouns and verbs deliberately, or check if the topic genuinely warrants the repetition.',
        });
      }
    }

    // ── 24. Paragraph length uniformity ──────────────────────────
    if (paragraphs.length >= 4) {
      const paraLengths = paragraphs.map(p => getSentences(p).length);
      const avg = paraLengths.reduce((a, b) => a + b, 0) / paraLengths.length;
      const allSimilar = paraLengths.every(l => Math.abs(l - avg) <= 1);
      if (allSimilar && avg >= 3) {
        issues.push({
          type: 'uniformity',
          text: `All paragraphs are ~${Math.round(avg)} sentences`,
          severity: 'low',
          suggestion: 'Vary paragraph length deliberately',
        });
      }
    }

    // ── 25. Bold overuse ─────────────────────────────────────────
    const boldMatches = text.match(/\*\*[^*]+\*\*/g) || [];
    if (boldMatches.length > 3) {
      issues.push({
        type: 'formatting',
        text: `${boldMatches.length} bold phrases`,
        severity: 'medium',
        suggestion: 'Strip bold from most; restructure to lead with key info',
      });
    }

    // ── Score from the deduped issue list ───────────────────────
    // Previously rawScore was accumulated inline per pattern hit, so
    // repeated hits of the same phrase (or overlapping matches) inflated
    // the score while the displayed issue list was deduplicated. That
    // produced the UX regression where a "heavy AI patterns" label sat
    // above a list of two items. Now the dedup runs first, then each
    // distinct issue contributes its category weight — so the number
    // reflects the same signals the user actually sees.
    const deduped = deduplicateIssues(issues);
    for (const issue of deduped) {
      rawScore += ISSUE_WEIGHTS[issue.type] ?? 2;
    }

    // Scale by text length: longer text gets more chances to trigger.
    const lengthFactor = Math.max(1, Math.log2(wordCount / 50));
    const normalizedScore = Math.min(100, Math.round(rawScore / lengthFactor));

    const label = getLabel(normalizedScore);

    // ── Sentence-region smoothing (HMM-style without an HMM) ─────────
    // Map each text-bearing issue back to its sentence indexes, then
    // merge adjacent flagged sentences into contiguous regions for UI
    // highlighting. Borrowed from GPTZero's sentence-highlighting model
    // — gives users "this paragraph is AI" rather than scattered hits.
    const regions = buildSentenceRegions(text, deduped);

    // Stats derived from the same deduped list so tier counts + patternCount
    // sum to `deduped.length`. Previously patternCount subtracted
    // `tier2Clusters` (a paragraph count) which produced inconsistent totals.
    const tier1Count = deduped.filter((i) => i.type === 'tier1').length;
    const tier2Count = deduped.filter((i) => i.type === 'tier2').length;
    const tier3Count = deduped.filter((i) => i.type === 'tier3').length;

    // ── Trinary classification (GPTZero-shaped) ──────────────────────
    // Decouples confidence from AI-proportion. Maps the 0-100 score plus
    // structural signals into HUMAN_ONLY / MIXED / AI_ONLY with a
    // confidence band. Thresholds are FN-biased: ambiguity routes to
    // MIXED, never AI_ONLY. Quote from GPTZero's design principle:
    // "biases the detector to prefer making less-harmful false-negative
    // errors over false-positive errors."
    // Dense-AI-vocab trifecta: ≥5 distinct tier1 hits + ≥2 tier2 cluster
    // paragraphs + ≥1 transition phrase, AND ≥150 words. Catches
    // saturated ChatGPT prose without firing on dense-jargon human
    // technical writing where the tier1 vocabulary (robust,
    // comprehensive, leverage, ecosystem) legitimately overlaps with
    // systems-programming idiom. Word-count gate prevents short ESL or
    // contrived adversarial sentences from tripping the corroborator.
    const tier1Distinct = new Set(deduped.filter((i) => i.type === 'tier1').map((i) => (i.text || '').toLowerCase())).size;
    const hasTier2Cluster = tier2Clusters >= 2;
    const hasTransition = deduped.some((i) => i.type === 'transition');
    const denseAIVocab = wordCount >= 150 && tier1Distinct >= 5 && hasTier2Cluster && hasTransition;

    const trinary = classifyTrinary({
      score: normalizedScore,
      issues: deduped,
      regions,
      normFlags: norm.flags,
      wordCount,
      denseAIVocab,
    });

    return {
      // Legacy fields preserved for existing callers.
      score: normalizedScore,
      label,
      issues: deduped,
      stats: {
        wordCount,
        tier1Count,
        tier2Count,
        tier2Clusters,
        tier3Count,
        tier3Flags,
        patternCount: deduped.length - tier1Count - tier2Count - tier3Count,
        contextMode,
        contextModeFallback,
        normalization: norm.flags,
        quotedLines,
        unmappedHighlights: regions._unmapped ?? 0,
        denseAIVocab,
        tier1Distinct,
      },
      // Trinary API — shape mirrors GPTZero so integrators can swap.
      document_classification: trinary.classification,
      class_probabilities: trinary.probabilities,
      confidence_category: trinary.confidence,
      highlight_sentence_for_ai: regions,
    };
  }

  // ═══ Sentence regions + trinary classifier ═════════════════════════

  function buildSentenceRegions(text, issues) {
    // Split text into sentences with byte offsets preserved so the UI
    // can highlight spans accurately. Sentence boundaries are coarse
    // (.!?) — fine for highlighting, not for linguistic correctness.
    const sentences = [];
    const sentenceRe = /[^.!?]+[.!?]+|\S[^.!?]*$/g;
    let m;
    while ((m = sentenceRe.exec(text)) !== null) {
      const trimmed = m[0].trim();
      if (trimmed.length < 4) continue;
      sentences.push({ start: m.index, end: m.index + m[0].length, text: trimmed });
    }
    if (sentences.length === 0) return [];

    // Map issue.text back to sentence indexes via substring search. Issues
    // without a meaningful text (e.g. summary signals like "Punctuation
    // density uniform across paragraphs") have no sentence anchor — they
    // contribute to the document-level signal but not to highlights.
    // Filter by issue TYPE not text-regex: text-based filtering used to
    // drop legitimate phrase issues containing "across" / "density".
    const SUMMARY_ONLY_TYPES = new Set([
      'punct-distribution',
      'cross-para-burstiness',
      'fnword-trigram-entropy',
      'smart-punct-signature',
      'normalization-flag',
      'uniformity',
      'em-dash',
      'formatting',
      'tier3',
      'tier3-phrase',
      'tier3-phrase-cluster',
      'hashtag-stuff',
      'bullet-np-list',
    ]);
    const hits = sentences.map(() => ({ count: 0, weight: 0 }));
    const lowerText = text.toLowerCase();
    let unmappedHighlights = 0;
    for (const issue of issues) {
      if (!issue.text || issue.text.length > 200) continue;
      if (SUMMARY_ONLY_TYPES.has(issue.type)) continue;
      const needle = issue.text.toLowerCase();
      let idx = 0;
      let matched = false;
      while ((idx = lowerText.indexOf(needle, idx)) !== -1) {
        matched = true;
        for (let i = 0; i < sentences.length; i++) {
          if (idx >= sentences[i].start && idx < sentences[i].end) {
            hits[i].count++;
            hits[i].weight += ISSUE_WEIGHTS[issue.type] ?? 2;
            break;
          }
        }
        idx += needle.length;
      }
      if (!matched) unmappedHighlights++;
    }

    // Window-merge contiguous flagged sentences. Allow 1 unflagged
    // sentence gap between two flagged ones (the "smoothing" — keeps
    // a single boring sentence from breaking what's clearly an AI
    // passage). A sentence is "flagged" if it has ≥1 hit.
    const regions = [];
    let cur = null;
    for (let i = 0; i < sentences.length; i++) {
      if (hits[i].count > 0) {
        if (cur === null) {
          cur = { startSentence: i, endSentence: i, start: sentences[i].start, end: sentences[i].end, hitCount: hits[i].count, weight: hits[i].weight };
        } else {
          cur.endSentence = i;
          cur.end = sentences[i].end;
          cur.hitCount += hits[i].count;
          cur.weight += hits[i].weight;
        }
      } else if (cur !== null) {
        // Allow one-sentence gap.
        const next = hits[i + 1];
        if (next && next.count > 0) {
          cur.endSentence = i;
          cur.end = sentences[i].end;
          continue;
        }
        regions.push(finalizeRegion(cur));
        cur = null;
      }
    }
    if (cur !== null) regions.push(finalizeRegion(cur));
    // Expose the unmapped-highlight count via a non-enumerable property
    // so the array length still reads naturally for consumers; the
    // analyzer pulls it into stats.unmappedHighlights for diagnostics.
    Object.defineProperty(regions, '_unmapped', { value: unmappedHighlights, enumerable: false });
    return regions;
  }

  function finalizeRegion(r) {
    // Map cumulative weight inside the region to a 0-1 score. Cap at 20
    // weight = 1.0 (matches Heavy threshold density).
    const score = Math.min(1, r.weight / 20);
    return {
      startSentence: r.startSentence,
      endSentence: r.endSentence,
      start: r.start,
      end: r.end,
      hitCount: r.hitCount,
      score: Math.round(score * 100) / 100,
    };
  }

  // FN-biased: false positives damage trust more than false negatives,
  // so MIXED is wide and AI_ONLY requires multiple signals. Quote from
  // GPTZero: "biases the detector to prefer making less-harmful
  // false-negative errors over false-positive errors."
  function classifyTrinary({ score, issues, regions, normFlags, wordCount, denseAIVocab }) {
    // Strong corroborators — each is near-dispositive on its own:
    //   - cutoff-disclaimer (LLM self-identifies as an AI)
    //   - reasoning-artifact + chatbot-artifact co-occurrence
    //   - normalization-flag at threshold (≥2 ZWSP or homoglyphs).
    //     Threshold parity prevents a single stray ZWSP in copy-paste
    //     from Word/Notion from flipping to AI_ONLY at score 0.
    //   - denseAIVocab: ≥4 distinct tier1 hits AND ≥1 tier2 cluster AND
    //     ≥1 transition phrase — the trifecta that saturated ChatGPT
    //     prose triggers without needing whitelisted stylometric hits.
    const hasCutoff = issues.some((i) => i.type === 'cutoff-disclaimer');
    const hasNormFlag = normFlags.zeroWidth >= 2 || normFlags.homoglyph >= 2;
    const hasReasoning = issues.some((i) => i.type === 'reasoning-artifact');
    const hasChatbot = issues.some((i) => i.type === 'chatbot');
    const strongCorrob =
      (hasCutoff ? 1 : 0) +
      (hasNormFlag ? 1 : 0) +
      (hasReasoning && hasChatbot ? 1 : 0) +
      (denseAIVocab ? 1 : 0);

    // Weak (stylometric) corroborators — suggestive on their own,
    // dispositive in combination. Smart-punct-signature matches
    // Word-edited human prose so doesn't count without other support.
    const stylometricHits = ['punct-distribution', 'cross-para-burstiness', 'fnword-trigram-entropy']
      .filter((t) => issues.some((i) => i.type === t)).length;
    const hasSmartPunct = issues.some((i) => i.type === 'smart-punct-signature');
    const weakCorrob = (stylometricHits >= 2 ? 1 : 0) + (hasSmartPunct ? 1 : 0);

    // Thresholds:
    //   score < 15 with no strong → HUMAN_ONLY
    //   strong ≥ 1 OR score ≥ 70 → AI_ONLY (lowered from 80; high
    //     density of AI vocab is sufficient evidence)
    //   score ≥ 40 with any corroborator → AI_ONLY
    //   everything else with score ≥ 15 → MIXED
    const totalCorrob = strongCorrob + weakCorrob;
    let classification;
    if (score < 15 && strongCorrob === 0) classification = 'HUMAN_ONLY';
    else if (strongCorrob >= 1 || score >= 70) classification = 'AI_ONLY';
    else if (score >= 40 && totalCorrob >= 1) classification = 'AI_ONLY';
    else classification = 'MIXED';

    // Humanizer-flag escalation: presence of bypass-trick chars is
    // adversarial signal. If a normalization-flag fired we already
    // counted it in strongCorrob → AI_ONLY. Confidence also gets a
    // floor of 'medium' in that case (an adversary actively evading
    // detection should never read as low-confidence noise).

    // Soft probability distribution. Not calibrated against a labeled
    // corpus yet (TODO when corpus exists — see roadmap.md). Largest
    // class is computed as `1 - others` after rounding to guarantee
    // sum=1 exactly. Sub-1% drift would otherwise hide in toFixed.
    const aiSoft = Math.min(0.97, score / 100 + totalCorrob * 0.06 + strongCorrob * 0.08);
    let p;
    if (classification === 'HUMAN_ONLY') p = { human: Math.max(0.6, 1 - aiSoft), mixed: Math.min(0.35, aiSoft * 0.8), ai: Math.min(0.1, aiSoft * 0.3) };
    else if (classification === 'AI_ONLY') p = { human: Math.max(0.02, 1 - aiSoft - 0.05), mixed: 0.1, ai: aiSoft };
    else p = { human: Math.max(0.15, 0.6 - aiSoft * 0.5), mixed: 0.5, ai: aiSoft * 0.7 };
    const rawSum = p.human + p.mixed + p.ai;
    p.human = +(p.human / rawSum).toFixed(3);
    p.mixed = +(p.mixed / rawSum).toFixed(3);
    // Assign ai as the remainder so the three values sum to exactly 1.
    // Clamp to >= 0 in case rounding pushes human+mixed above 1 (the
    // remainder would otherwise show as -0 or -0.001 — surfaces as a
    // negative percentage in any UI doing Math.round(p.ai * 100)).
    p.ai = Math.max(0, +(1 - p.human - p.mixed).toFixed(3));
    const probabilities = p;

    // Confidence band:
    //   high   — strongCorrob ≥ 2, OR cutoff-disclaimer, OR score < 8 (clean long doc)
    //   medium — strongCorrob ≥ 1, OR score ≥ 45 with weak corroborator, OR score < 20
    //   low    — everything else
    let confidence;
    if (strongCorrob >= 2 || hasCutoff || (score < 8 && wordCount >= 100)) confidence = 'high';
    else if (strongCorrob >= 1 || (score >= 45 && weakCorrob >= 1) || score < 20) confidence = 'medium';
    else confidence = 'low';

    return { classification, probabilities, confidence };
  }

  function getLabel(score) {
    if (score === 0) return 'Clean';
    if (score <= 15) return 'Minimal AI signals';
    if (score <= 35) return 'Some AI patterns';
    if (score <= 60) return 'Moderate AI signals';
    if (score <= 80) return 'Strong AI signals';
    return 'Heavy AI patterns';
  }

  function getColor(score) {
    if (score <= 15) return '#44bb66';
    if (score <= 35) return '#88bb44';
    if (score <= 60) return '#ddaa00';
    if (score <= 80) return '#ff8833';
    return '#ff4444';
  }

  function deduplicateIssues(issues) {
    const seen = new Set();
    return issues.filter(issue => {
      const key = `${issue.type}:${issue.text.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ─── Severity labels ──────────────────────────────────────────
  const SEVERITY_LABELS = {
    critical: 'P0',
    high: 'P1',
    medium: 'P2',
    low: 'P3',
  };

  const TYPE_LABELS = {
    'tier1': 'AI vocabulary',
    'tier2': 'Word cluster',
    'tier3': 'Overused word',
    'transition': 'AI transition',
    'chatbot': 'Chatbot artifact',
    'sycophantic': 'Sycophantic tone',
    'filler': 'Filler phrase',
    'generic-conclusion': 'Generic conclusion',
    'lets-construction': '"Let\'s" opener',
    'reasoning-artifact': 'Reasoning artifact',
    'acknowledgment-loop': 'Acknowledgment loop',
    'significance-inflation': 'Significance inflation',
    'vague-attribution': 'Vague attribution',
    'hollow-intensifier': 'Hollow intensifier',
    'emotional-flatline': 'Emotional flatline',
    'novelty-inflation': 'Novelty inflation',
    'cutoff-disclaimer': 'Cutoff disclaimer',
    'template-phrase': 'Template phrase',
    'false-concession': 'False concession',
    'rhetorical-question': 'Rhetorical question',
    'confidence-calibration': 'Confidence stacking',
    'em-dash': 'Em dash overuse',
    'uniformity': 'Rhythm uniformity',
    'formatting': 'Formatting',
    'tier3-phrase': 'Boilerplate phrase',
    'tier3-phrase-cluster': 'Boilerplate cluster',
    'hashtag-stuff': 'Hashtag stuffing',
    'bullet-np-list': 'Bullet-NP list',
    'hedge-stack': 'Hedge-stacked prediction',
    'future-narrative': 'Generic future narrative',
    'real-actual-inflation': '"Real/actual" inflation',
    'social-cta-closer': 'Engagement-bait closer',
    'formulaic-opener': 'Formulaic opener',
    'title-case-header': 'Title Case header',
    'parenthetical-hedge': 'Parenthetical hedge',
    'smart-punct-signature': 'Smart-punct signature',
    'punct-distribution': 'Punctuation distribution',
    'fnword-trigram-entropy': 'Grammar repetition',
    'cross-para-burstiness': 'Cross-paragraph rhythm',
    'normalization-flag': 'Bypass-trick chars',
    'low-ttr': 'Low vocabulary diversity',
    'ai-placeholder': 'Unfilled placeholder',
    'ai-citation-markup': 'Chatbot citation markup leak',
    'ai-utm-source': 'AI-tool URL parameter',
  };

  return {
    analyzeText,
    normalizeText,
    getLabel,
    getColor,
    SEVERITY_LABELS,
    TYPE_LABELS,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIDetector;
}
