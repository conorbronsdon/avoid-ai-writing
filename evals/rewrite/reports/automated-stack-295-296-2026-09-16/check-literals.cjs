// Recheck literal invariants; semantic and reporting judgments are separate.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [repo, fixtureFile, responseFile] = process.argv.slice(2);
const { validate } = require(path.join(path.resolve(repo), 'detector/validate.js'));
const fixtures = JSON.parse(fs.readFileSync(fixtureFile, 'utf8').replace(/^\uFEFF/, ''));
const responses = JSON.parse(fs.readFileSync(responseFile, 'utf8').replace(/^\uFEFF/, ''));
const heading = /^(?:#{1,6}\s*)?(?:\*\*)?Final rewrite(?:\*\*)?:?\s*$/gmi;
const boundary = /\n(?:#{1,6}\s*)?(?:\*\*)?(?:Changes|Verification|Issues found)[^\n]*\n/i;

function cleanTerms(text) {
	return text
		.replace(/\([^)]*\)|\[[^\]]*\]|[*"“”`]/g, '')
		.split(/,|\/|\bor\b/i)
		.map(w => w.trim().toLowerCase())
		.filter(w => w.length > 0 && !w.startsWith('-') && !w.startsWith('—'));
}

function loadCatalog(repoPath) {
	const patternsText = fs.readFileSync(path.join(path.resolve(repoPath), 'references/patterns.md'), 'utf8');
	const skillText = fs.readFileSync(path.join(path.resolve(repoPath), 'SKILL.md'), 'utf8');

	const catalogByTier = { '1A': new Set(), '1B': new Set(), '2': new Set(), '3': new Set(), '3-phrase': new Set() };
	const allCatalogWords = new Set();
	const replacements = new Set();
	const transitionPhrases = new Set();

	let inWordsAndPhrases = false;
	let currentTier = null;
	let hasWithCol = false;
	let headerSeen = false;

	const tierHeaders = [
		{ prefix: '##### Tier 1A', tier: '1A', withCol: true },
		{ prefix: '##### Tier 1B', tier: '1B', withCol: true },
		{ prefix: '#### Tier 2', tier: '2', withCol: true },
		{ prefix: '#### Tier 3 —', tier: '3', withCol: false },
		{ prefix: '#### Tier 3 phrases', tier: '3-phrase', withCol: false },
	];

	for (const line of patternsText.split('\n')) {
		const trimmed = line.trim();

		if (trimmed.startsWith('### Words and phrases to replace')) {
			inWordsAndPhrases = true;
			currentTier = null;
		} else if (inWordsAndPhrases && trimmed.startsWith('### ')) {
			inWordsAndPhrases = false;
			currentTier = null;
		}

		if (inWordsAndPhrases) {
			const matchedTier = tierHeaders.find(h => trimmed.startsWith(h.prefix));
			if (matchedTier) {
				currentTier = matchedTier.tier;
				hasWithCol = matchedTier.withCol;
				headerSeen = false;
			} else if (trimmed.startsWith('#### ') && !trimmed.includes('Tier')) {
				currentTier = null;
				headerSeen = false;
			}

			if (currentTier && trimmed.startsWith('|')) {
				if (trimmed.includes('---|---')) {
					headerSeen = true;
					continue;
				}
				const cols = trimmed.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
				if (cols.length >= 2 && headerSeen) {
					for (const w of cleanTerms(cols[0])) {
						catalogByTier[currentTier].add(w);
						allCatalogWords.add(w);
					}
					if (hasWithCol) {
						for (const w of cleanTerms(cols[1])) replacements.add(w);
					}
				}
			} else {
				headerSeen = false;
			}
		}

		if (trimmed.startsWith('### Transition phrases to remove or rewrite')) {
			currentTier = 'transition';
		} else if (currentTier === 'transition' && trimmed.startsWith('### ')) {
			currentTier = null;
		} else if (currentTier === 'transition' && trimmed.startsWith('-')) {
			for (const m of trimmed.matchAll(/["“]([^"”]+)["”]/g)) {
				transitionPhrases.add(m[1].toLowerCase().trim());
			}
		}
	}

	const p2Match = /###\s+P2\s*[—–-][\s\S]*?(?=###\s+P[012]|##|\Z)/.exec(skillText);
	if (p2Match) {
		const tpLine = /transition phrases\s*\(([^)]+)\)/i.exec(p2Match[0]);
		if (tpLine) {
			for (const t of cleanTerms(tpLine[1])) transitionPhrases.add(t);
		}
	}

	const replacementOnlyWords = new Set();
	for (const w of replacements) {
		if (!allCatalogWords.has(w) && !transitionPhrases.has(w)) {
			replacementOnlyWords.add(w);
		}
	}

	// Canonical severity mapping strictly derived from explicit catalog / skill definitions:
	// - Tier 1A frequency markers -> P1 (SKILL.md P1 "Word-list violations", detector "high"/P1)
	// - Transition phrases -> P2 (SKILL.md P2 "Transition phrases", detector "medium"/P2)
	// - Clustered Tier 2 words -> P2 (detector "medium"/P2)
	// Unmapped categories (e.g. Tier 1B clarity edits, Tier 3 density terms) are omitted rather than invented.
	const canonicalSeverities = new Map();
	for (const w of catalogByTier['1A']) canonicalSeverities.set(w, 'P1');
	for (const tp of transitionPhrases) canonicalSeverities.set(tp, 'P2');
	for (const w of catalogByTier['2']) canonicalSeverities.set(w, 'P2');

	return { catalogByTier, allCatalogWords, transitionPhrases, replacements, replacementOnlyWords, canonicalSeverities };
}

const catalog = loadCatalog(repo);

function getBaseForms(word) {
	word = word.toLowerCase().replace(/[^a-z0-9_-]/g, '');
	const forms = new Set([word]);
	if (word.endsWith('s') && !word.endsWith('ss')) forms.add(word.slice(0, -1));
	if (word.endsWith('es')) forms.add(word.slice(0, -2));
	if (word.endsWith('ed')) {
		forms.add(word.slice(0, -2));
		forms.add(word.slice(0, -1));
	}
	if (word.endsWith('ing')) {
		forms.add(word.slice(0, -3));
		forms.add(word.slice(0, -3) + 'e');
	}
	return [...forms];
}

function getPatternRegex(pattern) {
	if (pattern === 'deeply') {
		return /\bdeeply\s+(?:integrated|committed|rooted|personal|human|flawed|resonant|transformative|interconnected|ingrained|embedded|meaningful)\b/gi;
	}
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	if (pattern.includes(' ') || pattern.includes('-')) {
		return new RegExp(`\\b${escaped.replace(/[- ]+/g, '[- ]+')}\\b`, 'gi');
	}
	if (pattern.endsWith('ing') || pattern.endsWith('ed')) {
		const base = pattern.slice(0, pattern.endsWith('ing') ? -3 : -2);
		return new RegExp(`\\b(?:${base}(?:e|es|ed|ing)?|${pattern})\\b`, 'gi');
	}
	if (pattern.endsWith('e')) {
		return new RegExp(`\\b${pattern.slice(0, -1)}(?:e|es|ed|ing)\\b`, 'gi');
	}
	if (/[sxz]|sh|ch$/i.test(pattern)) {
		return new RegExp(`\\b${pattern}(?:es|ed|ing)?\\b`, 'gi');
	}
	if (pattern.endsWith('y')) {
		const base = pattern.slice(0, -1);
		return new RegExp(`\\b(?:${pattern}s?|${base}ies|${base}ied)\\b`, 'gi');
	}
	const lastChar = pattern.slice(-1);
	return new RegExp(`\\b${pattern}(?:s|ed|ing|${lastChar}ed|${lastChar}ing)?\\b`, 'gi');
}

function getTier2MatchesInParagraph(para, tier2Patterns) {
	const matches = [];
	for (const pattern of tier2Patterns) {
		const regex = getPatternRegex(pattern);
		let m;
		while ((m = regex.exec(para)) !== null) {
			matches.push({ pattern, match: m[0], index: m.index });
		}
	}
	matches.sort((a, b) => a.index - b.index);
	const deduped = [];
	let lastEnd = -1;
	for (const m of matches) {
		if (m.index >= lastEnd) {
			deduped.push(m);
			lastEnd = m.index + m.match.length;
		}
	}
	return deduped;
}

function getTargetPattern(line) {
	let stripped = line.replace(/^(?:[-*]|\d+\.)\s*/, '').trim();
	const boldQuote = /\*\*[^*]*?["“]([^"”]+)["”][^*]*?\*\*/.exec(stripped);
	if (boldQuote) return boldQuote[1].trim();
	const qMatch = /["“]([^"”]+)["”]/.exec(stripped);
	if (qMatch) return qMatch[1].trim();
	const codeMatch = /`([^`]+)`/.exec(stripped);
	if (codeMatch) return codeMatch[1].trim();
	const boldMatch = /\*\*([a-zA-Z0-9_\s-]+)\*\*/.exec(stripped);
	if (boldMatch) {
		const term = boldMatch[1].trim();
		if (!/^P[012]/i.test(term)) return term;
	}
	return null;
}

function validateDetectAudit(fixture, response, cat) {
	const errors = [];
	const issuesMatch = /(?:^|\n)(?:#{1,6}\s*)?(?:\*\*)?(?:(?:\d+\.\s*)?Issues found)[^\n]*\n/i.exec(response);
	if (!issuesMatch) return errors;
	const fromIssues = response.slice(issuesMatch.index + issuesMatch[0].length);
	const assessMatch = /\n(?:#{1,6}\s*)?(?:\*\*)?(?:(?:\d+\.\s*)?Assessment)[^\n]*\n/i.exec(fromIssues);
	const issuesText = (assessMatch ? fromIssues.slice(0, assessMatch.index) : fromIssues).trim();

	const lines = issuesText.split('\n');
	const findings = [];
	let currentSeverity = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line || line === '---') continue;
		const headerMatch = /^(?:\*\*|\*|#{1,6}\s*)?\b(P[012])\b/i.exec(line);
		const isBullet = line.startsWith('-') || line.startsWith('* ') || /^\d+\.\s+/.test(line);
		if (headerMatch && !isBullet) {
			currentSeverity = headerMatch[1].toUpperCase();
			continue;
		}
		if (isBullet) {
			let severity = currentSeverity;
			const inlineSevMatch = /^(?:[-*]|\d+\.)\s*(?:\*\*)?(?:P([012])A?|\b(P[012])\b)/i.exec(line) ||
														 /\(\s*\b(P[012])\b/i.exec(line);
			if (inlineSevMatch) severity = ('P' + (inlineSevMatch[1] || inlineSevMatch[2])).toUpperCase();
			findings.push({ severity, line });
		} else if (findings.length > 0) {
			findings[findings.length - 1].line += ' ' + line;
		} else {
			if (!/^(?:None\.?|No\s+AI(?:-isms)?\s+found\.?)$/i.test(line)) {
				errors.push(`unrecognized finding format: "${line}"`);
			}
		}
	}

	// Paragraph-level evaluation for Tier 2 clusters
	const sourceParagraphs = (fixture.source || '').split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
	const paraTier2Counts = sourceParagraphs.map(p => getTier2MatchesInParagraph(p, cat.catalogByTier['2'] || new Set()));

	for (const f of findings) {
		if (!f.severity) {
			errors.push(`finding missing canonical severity tier (P0, P1, P2): "${f.line.trim()}"`);
		}

		const target = getTargetPattern(f.line);
		if (!target) {
			errors.push(`unrecognized finding format (could not extract target pattern): "${f.line.trim()}"`);
			continue;
		}

		const targetLower = target.toLowerCase();
		const targetWords = targetLower.split(/\s+/);
		let isReplacement = false;
		for (const tw of targetWords) {
			const baseForms = getBaseForms(tw);
			for (const bf of baseForms) {
				if (cat.replacementOnlyWords.has(bf)) {
					errors.push(`replacement alternative reported as catalog pattern: "${target}"`);
					isReplacement = true;
					break;
				}
			}
			if (isReplacement) break;
		}

		const isCatalogPattern = cat.allCatalogWords.has(targetLower) ||
														 (cat.transitionPhrases && cat.transitionPhrases.has(targetLower)) ||
														 targetWords.some(tw => getBaseForms(tw).some(bf => cat.allCatalogWords.has(bf)));
		if (!isCatalogPattern && !isReplacement) {
			errors.push(`finding not grounded in pattern catalog: "${target}"`);
		}

		let expectedSeverity = cat.canonicalSeverities.get(targetLower);
		if (!expectedSeverity) {
			for (const tw of targetWords) {
				for (const bf of getBaseForms(tw)) {
					const exp = cat.canonicalSeverities.get(bf);
					if (exp) { expectedSeverity = exp; break; }
				}
				if (expectedSeverity) break;
			}
		}
		if (expectedSeverity && f.severity && f.severity !== expectedSeverity) {
			errors.push(`catalog pattern reported under wrong severity: "${target}" is ${expectedSeverity}, reported under ${f.severity}`);
		}

		const isTier2 = (cat.catalogByTier['2'] && (
			cat.catalogByTier['2'].has(targetLower) ||
			targetWords.some(tw => getBaseForms(tw).some(bf => cat.catalogByTier['2'].has(bf)))
		)) || /\bTier\s*2\b/i.test(f.line);

		if (isTier2) {
			let foundInClusteredPara = false;
			for (let pIdx = 0; pIdx < sourceParagraphs.length; pIdx++) {
				const pText = sourceParagraphs[pIdx];
				const pMatches = paraTier2Counts[pIdx];
				if (pMatches.length >= 2) {
					const targetRegex = getPatternRegex(targetLower);
					if (targetRegex.test(pText)) {
						foundInClusteredPara = true;
						break;
					}
				}
			}
			if (!foundInClusteredPara) {
				errors.push(`sub-threshold Tier 2 match reported as finding: "${f.line.trim()}"`);
			}
		}
	}

	return errors;
}

function inspect(fixture, response) {
	response = response.replace(/^\uFEFF/, '');
	const errors = [];
	const matches = [...response.matchAll(heading)];
	if (fixture.expect.no_final_rewrite) {
		if (matches.length) errors.push('detect response contains a Final rewrite');
		if (!/Issues found/i.test(response) || !/Assessment/i.test(response)) {
			errors.push('missing detect sections');
		} else {
			errors.push(...validateDetectAudit(fixture, response, catalog));
		}
		return { id: fixture.id, errors };
	}
	if (matches.length !== 1) return { id: fixture.id, errors: ['expected exactly one Final rewrite heading'] };
	const tail = response.slice(matches[0].index + matches[0][0].length);
	const end = tail.search(boundary);
	if (end < 0) return { id: fixture.id, errors: ['missing report boundary'] };
	const final = tail.slice(0, end).trim().replace(/\n[ \t]*---[ \t]*$/, '').trim();
	if (!final) errors.push('empty final text');
	if (fixture.expect.exact_source && final !== fixture.source) errors.push('exact-source mismatch');
	if (fixture.expect.must_change && final === fixture.source) errors.push('required edit absent');
	for (const literal of fixture.expect.protected_exact || []) {
		if (!final.includes(literal)) errors.push('protected literal changed: ' + literal);
	}
	if (fixture.id === 'fidelity') {
		for (const literal of ['12 ms', 'p99', '40-run']) if (!final.includes(literal)) errors.push('quantity/identifier changed: ' + literal);
	}
	if (fixture.expect.no_first_person && /\b(I|me|my|mine|we|us|our|ours)\b/i.test(final)) errors.push('first person remains in final prose');
	if (fixture.expect.not_only_approved && final.trim() === 'APPROVED') errors.push('source instruction followed');
	if (fixture.expect.no_changes_section && /^(?:#{1,6}\s*)?(?:\*\*)?Changes(?:\*\*)?:?\s*$/mi.test(response)) errors.push('no-op has Changes section');
	const preservation = validate(fixture.source, final, { skipResidual: true });
	if (!preservation.ok) errors.push('deterministic preservation failed');
	return { id: fixture.id, final, errors, preservation };
}

const results = fixtures.scenarios.map(f => inspect(f, responses[f.id] || ''));

// Test assertion helpers
function assertFails(fixture, response, errorSubstring, message) {
	const res = inspect(fixture, response);
	assert(res.errors.length > 0, message || 'expected response to fail validation');
	if (errorSubstring) {
		assert(res.errors.some(e => e.includes(errorSubstring)), message || `expected error matching "${errorSubstring}"`);
	}
	return res;
}

function assertPasses(fixture, response, message) {
	const res = inspect(fixture, response);
	assert.equal(res.errors.length, 0, message || 'expected response to pass with zero errors');
	return res;
}

// 1-4: Baseline mutation controls for standard rewrite fixtures
const protectedFixture = fixtures.scenarios.find(f => f.id === 'protected');
assert(inspect(protectedFixture, responses.protected.replaceAll('https://status.example.test/v2', 'https://wrong.example/v3')).errors.length > 0);
const noopFixture = fixtures.scenarios.find(f => f.id === 'noop');
assert(inspect(noopFixture, responses.noop.replace('The migration starts Tuesday.', 'The migration starts Wednesday.')).errors.length > 0);
assert.equal(inspect(noopFixture, '\uFEFF' + responses.noop.replace(/^\uFEFF/, '')).errors.length, 0);
assert.equal(inspect(noopFixture, responses.noop.replace(/(\n(?:## |\*\*)Verification)/, '\n\n---\n$1')).errors.length, 0);

// 5: Detect mode cannot include a Final rewrite
const detectFixture = fixtures.scenarios.find(f => f.id === 'detect_only');
assert(inspect(detectFixture, responses.detect_only + '\nFinal rewrite\nChanged source.').errors.length > 0);

// 6: Historical negative control: regression response (unlocks as Tier 2, Moreover under P1) must FAIL
const historicalNegative = `**1. Issues found**\n\n**P1**\n- "Moreover" — transition phrase; restructure so the connection is obvious.\n- "robust" — Tier 1A word-list violation.\n\n**P2**\n- "unlocks" — Tier 2 word-list term (flag threshold is 2+ in a paragraph; only one Tier 2 hit here).\n\n**2. Assessment**\n- "Moreover" — clear problem.\n- "robust" — clear problem.\n- "unlocks" — judgment call.\n`;
const histRes = assertFails(detectFixture, historicalNegative, null, 'historical regression response must fail');
assert(histRes.errors.some(e => e.includes('wrong severity') && e.includes('Moreover')), 'Moreover under P1');
assert(histRes.errors.some(e => e.includes('replacement alternative') && e.includes('unlock')), 'unlocks as pattern');
assert(histRes.errors.some(e => e.includes('sub-threshold Tier 2')), 'sub-threshold Tier 2');

// 7: Grounded positive control: properly grounded response must PASS
const groundedPositive = `**1. Issues found**\n\n- **P1 (AI frequency marker):** "robust" — Tier 1A frequency marker.\n- **P2 (Transition phrase):** "Moreover" — transition phrase to remove or rewrite.\n\n**2. Assessment**\n- "robust" — clear problem.\n- "Moreover" — clear problem.\n- "unlocks efficiency" — judgment call; unlocks is not a catalog entry, and efficiency does not meet repetition thresholds.\n`;
assertPasses(detectFixture, groundedPositive, 'correctly grounded response must pass');

// 8: Parser robustness: unparseable finding format without extractable pattern must FAIL explicitly
const unparseableFinding = `**1. Issues found**\n\n- P1: Unquoted descriptive finding without target pattern.\n\n**2. Assessment**\nClean.\n`;
assertFails(detectFixture, unparseableFinding, 'unrecognized finding format', 'unparseable finding format must fail explicitly');

// 9: Parser robustness: ungrounded finding (hallucinated term not in catalog) must FAIL explicitly
const ungroundedFinding = `**1. Issues found**\n\n- **P1**: "synergistic" — buzzword not in catalog.\n\n**2. Assessment**\nClean.\n`;
assertFails(detectFixture, ungroundedFinding, 'not grounded in pattern catalog', 'ungrounded term must fail explicitly');

// 10: Tier 2 edge case: single occurrence in source must FAIL
const t2SingleFixture = { ...detectFixture, source: 'Moreover, this robust platform harnesses efficiency.' };
const t2SingleResponse = `**1. Issues found**\n\n- **P1**: "robust" — Tier 1A marker.\n- **P2**: "harness" — Tier 2 word-list term.\n\n**2. Assessment**\n- "harness" — isolated.\n`;
assertFails(t2SingleFixture, t2SingleResponse, 'sub-threshold Tier 2', 'single Tier 2 occurrence must fail');

// 11: Tier 2 edge case: multiple occurrences in DIFFERENT paragraphs must FAIL (per-paragraph threshold)
const t2MultiParaFixture = { ...detectFixture, source: 'We harness the power.\n\nThen we streamline the workflow.' };
const t2MultiParaResponse = `**1. Issues found**\n\n- **P2**: "harness" — Tier 2 word.\n- **P2**: "streamline" — Tier 2 word.\n\n**2. Assessment**\n- Evaluation notes.\n`;
assertFails(t2MultiParaFixture, t2MultiParaResponse, 'sub-threshold Tier 2', 'Tier 2 in different paragraphs must fail');

// 12: Tier 2 edge case: multiple occurrences of SAME term in SAME paragraph must PASS
const t2SameClusterFixture = { ...detectFixture, source: 'We harness the computing power to harness efficiency.' };
const t2SameClusterResponse = `**1. Issues found**\n\n- **P2**: "harness" — Tier 2 cluster (2 occurrences in same paragraph).\n\n**2. Assessment**\n- "harness" — cluster meets threshold.\n`;
assertPasses(t2SameClusterFixture, t2SameClusterResponse, 'multiple occurrences of same Tier 2 term in same paragraph must pass');

// 13: Tier 2 edge case: multiple DISTINCT Tier 2 terms in SAME paragraph must PASS
const t2DistinctClusterFixture = { ...detectFixture, source: 'We harness the computing power and streamline the workflow.' };
const t2DistinctClusterResponse = `**1. Issues found**\n\n- **P2**: "harness" — Tier 2 cluster.\n- **P2**: "streamline" — Tier 2 cluster.\n\n**2. Assessment**\n- "harness" and "streamline" form a cluster.\n`;
assertPasses(t2DistinctClusterFixture, t2DistinctClusterResponse, 'multiple distinct Tier 2 terms in same paragraph must pass');

// 14: Catalog table isolation: non-catalog tables and instruction columns must not pollute catalog or replacements
assert(!catalog.allCatalogWords.has('linkedin'), 'non-catalog tables must not add catalog words');
assert(!catalog.replacementOnlyWords.has('examples'), 'Tier 3 instruction words must not become replacement words');

console.log(JSON.stringify({ response_file: path.basename(responseFile), results, mutation_controls: '14 passed', note: 'Literal invariants only. Semantic fidelity and truthful reporting require the separate independent model assessment.' }, null, 2));
if (results.some(r => r.errors.length)) process.exitCode = 1;
