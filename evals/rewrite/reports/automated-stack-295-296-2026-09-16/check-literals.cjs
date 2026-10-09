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
	const stripped = text.replace(/[*"“”`]/g, '');
	const parts = stripped.split(/,|\/|\bor\b/i);
	const results = [];
	for (let part of parts) {
		part = part.trim();
		if (!part || part.startsWith('-') || part.startsWith('—')) continue;
		if (/\([A-Z]\s+(?:with|and)\s+[A-Z]\)|\[[A-Za-z]+\]/i.test(part)) continue;
		let cleaned = part.replace(/\([^)]*\)|\*\(.*?\)\*|\[[^\]]*\]/g, '').trim().toLowerCase();
		if (cleaned.length > 0) results.push(cleaned);
		if (part.includes('(sustainable)')) results.push('sustainable reward emissions');
		if (part.includes('poised (to)')) results.push('poised to');
	}
	return results;
}

function loadCatalog(repoPath) {
	const patternsText = fs.readFileSync(path.join(path.resolve(repoPath), 'references/patterns.md'), 'utf8');
	const skillText = fs.readFileSync(path.join(path.resolve(repoPath), 'SKILL.md'), 'utf8');

	const catalogByTier = { '1A': new Set(), '1B': new Set(), '2': new Set(), '3': new Set(), '3-phrase': new Set() };
	const tierByPattern = new Map();
	const allCatalogWords = new Set();
	const replacements = new Set();
	const transitionPhrases = new Set();
	const templates = [];

	let inWordsAndPhrases = false;
	let inTransition = false;
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
			inTransition = false;
			currentTier = null;
		} else if (inWordsAndPhrases && trimmed.startsWith('### ')) {
			inWordsAndPhrases = false;
			currentTier = null;
		}

		if (trimmed.startsWith('### Transition phrases to remove or rewrite')) {
			inTransition = true;
			inWordsAndPhrases = false;
			currentTier = null;
			continue;
		} else if (inTransition && trimmed.startsWith('### ')) {
			inTransition = false;
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
					if (/\([A-Z]\s+(?:with|and)\s+[A-Z]\)|\[[A-Za-z]+\]/i.test(cols[0])) {
						const parts = cols[0].split(/,|\/|\bor\b/i);
						for (let p of parts) {
							p = p.trim().replace(/[*"“”`]/g, '');
							if (/\([A-Z]\s+(?:with|and)\s+[A-Z]\)|\[[A-Za-z]+\]/i.test(p)) {
								let tRegex = null;
								if (/the integration of \(X with Y\)/i.test(p)) {
									tRegex = /^the integration of\s+(.+?)\s+with\s+(.+)$/i;
								} else if (/the intersection of \(X and Y\)/i.test(p)) {
									tRegex = /^the intersection of\s+(.+?)\s+and\s+(.+)$/i;
								} else if (/designed for long-term \[X\]/i.test(p)) {
									tRegex = /^designed for long-term\s+(.+)$/i;
								}
								if (tRegex) {
									templates.push({ raw: p.toLowerCase(), regex: tRegex, tier: currentTier });
								}
							}
						}
					}
					for (const w of cleanTerms(cols[0])) {
						catalogByTier[currentTier].add(w);
						tierByPattern.set(w, currentTier);
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

		if (inTransition && trimmed.startsWith('-')) {
			const arrowIdx = trimmed.indexOf('→');
			const left = arrowIdx !== -1 ? trimmed.slice(1, arrowIdx) : trimmed.slice(1);
			const right = arrowIdx !== -1 ? trimmed.slice(arrowIdx + 1) : '';

			for (const m of left.matchAll(/["“]([^"”]+)["”]/g)) {
				let phrase = m[1].toLowerCase().trim().replace(/[.,!?:;]+$/, '');
				if (phrase.includes('[x]')) {
					templates.push({
						raw: phrase,
						regex: new RegExp('^' + phrase.replace(/\[x\]/i, '(.+)') + '$', 'i'),
						tier: 'transition',
					});
				} else {
					transitionPhrases.add(phrase);
				}
			}

			if (right) {
				for (const m of right.matchAll(/["“]([^"”]+)["”]/g)) {
					let alt = m[1].toLowerCase().trim().replace(/[.,!?:;]+$/, '');
					if (alt) replacements.add(alt);
				}
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

	const genericConclusions = new Set([
		'the future looks bright',
		'only time will tell',
		'one thing is certain',
		'as we move forward',
	]);

	const canonicalSeverities = new Map();
	for (const w of catalogByTier['1A']) {
		if (genericConclusions.has(w)) {
			canonicalSeverities.set(w, 'P2');
		} else {
			canonicalSeverities.set(w, 'P1');
		}
	}
	for (const tp of transitionPhrases) canonicalSeverities.set(tp, 'P2');
	for (const t of templates) {
		if (t.tier === 'transition' || t.tier === '2') canonicalSeverities.set(t.raw, 'P2');
	}
	for (const w of catalogByTier['2']) canonicalSeverities.set(w, 'P2');

	return { catalogByTier, tierByPattern, allCatalogWords, transitionPhrases, templates, replacements, replacementOnlyWords, canonicalSeverities };
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
	if (/(?:[sxz]|sh|ch)$/i.test(pattern)) {
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

function getTargetPattern(line, cat) {
	let stripped = line.replace(/^(?:[-*]|\d+\.)\s*/, '').trim();
	const quotes = [...stripped.matchAll(/["“]([^"”]+)["”]/g)].map(m => m[1].trim());
	if (quotes.length > 0) {
		if (cat) {
			const catalogQuote = quotes.find(q => {
				const qLower = q.toLowerCase().replace(/^[^a-z0-9_-]+|[^a-z0-9_-]+$/g, '');
				return cat.allCatalogWords.has(qLower) ||
				       cat.transitionPhrases.has(qLower) ||
				       getBaseForms(qLower).some(bf => cat.allCatalogWords.has(bf));
			});
			if (catalogQuote) return catalogQuote;
		}
		return quotes[0];
	}
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
	const issuesMatch = /(?:^|\n)(?:#{1,6}\s*)?(?:\*\*)?(?:(?:\d+\.\s*)?Issues found)[^\n]*(?:\n|$)/i.exec(response);
	const assessMatch = /(?:^|\n)(?:#{1,6}\s*)?(?:\*\*)?(?:(?:\d+\.\s*)?Assessment)[^\n]*(?:\n|$)/i.exec(response);

	if (!issuesMatch || !assessMatch) {
		if (!issuesMatch) errors.push('missing or malformed Issues found section');
		if (!assessMatch) errors.push('missing or malformed Assessment section');
		return errors;
	}
	if (assessMatch.index <= issuesMatch.index) {
		errors.push('expected Issues found section before Assessment section');
		return errors;
	}

	const issuesText = response.slice(issuesMatch.index + issuesMatch[0].length, assessMatch.index).trim();
	const lines = issuesText.split('\n');
	const findings = [];
	let currentSeverity = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line || line === '---') continue;

		const headerMatch = /^(?:#{1,6}\s*|\*\*|\*)?\b(P[012])\b/i.exec(line);
		const isBullet = /^(?:[-*]|\d+\.)\s+/.test(line);

		if (headerMatch && !isBullet) {
			currentSeverity = headerMatch[1].toUpperCase();
			continue;
		}

		if (!isBullet && /^(?:#{1,6}\s*|\*\*|\*)?(?:Tier\s*1A|Tier\s*1B|Tier\s*2|Tier\s*3)/i.test(line)) {
			continue;
		}

		if (/^no\s+.*found\.?$/i.test(line) || /^none\.?$/i.test(line)) {
			continue;
		}

		if (isBullet) {
			let severity = currentSeverity;
			const explicitSevMatch = /\b(P\d+)\b/i.exec(line);
			if (explicitSevMatch) {
				const label = explicitSevMatch[1].toUpperCase();
				if (label === 'P0' || label === 'P1' || label === 'P2') {
					severity = label;
				} else {
					severity = null;
				}
			}
			findings.push({ severity, line, rawExplicitSev: explicitSevMatch ? explicitSevMatch[1] : null });
		} else if (findings.length > 0) {
			if (!/^(?:#{1,6}\s*|\*\*|\*)/.test(line)) {
				findings[findings.length - 1].line += ' ' + line;
			}
		}
	}

	const sourceText = fixture.source || '';
	const sourceParagraphs = sourceText.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
	const paraTier2Counts = sourceParagraphs.map(p => getTier2MatchesInParagraph(p, cat.catalogByTier['2'] || new Set()));

	for (const f of findings) {
		if (!f.severity) {
			errors.push(`finding missing canonical severity tier (P0, P1, P2): "${f.line.trim()}"`);
		}

		const target = getTargetPattern(f.line, cat);
		if (!target) {
			errors.push(`unrecognized finding format (could not extract target pattern): "${f.line.trim()}"`);
			continue;
		}

		const targetLower = target.toLowerCase().trim();
		const cleanTarget = targetLower.replace(/^[^a-z0-9_-]+|[^a-z0-9_-]+$/g, '');

		const matchedTemplate = (cat.templates || []).find(t => cleanTarget === t.raw || t.regex.test(cleanTarget));

		let matchedTransition = null;
		if (cat.transitionPhrases.has(cleanTarget)) {
			matchedTransition = cleanTarget;
		} else {
			for (const tp of cat.transitionPhrases) {
				const tpRegex = new RegExp(`\\b${tp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
				if (tpRegex.test(cleanTarget)) {
					matchedTransition = tp;
					break;
				}
			}
		}

		const targetWords = cleanTarget.split(/\s+/);
		const isSingleWord = targetWords.length === 1;
		const targetBases = getBaseForms(cleanTarget);

		const isCatalogPattern = Boolean(
			cat.allCatalogWords.has(cleanTarget) ||
			matchedTransition ||
			matchedTemplate ||
			(isSingleWord && targetBases.some(bf => cat.allCatalogWords.has(bf)))
		);

		if (!isCatalogPattern) {
			if (cat.replacementOnlyWords.has(cleanTarget) ||
			    (isSingleWord && targetBases.some(bf => cat.replacementOnlyWords.has(bf)))) {
				errors.push(`replacement alternative reported as catalog pattern: "${target}"`);
			} else {
				errors.push(`finding not grounded in pattern catalog: "${target}"`);
			}
		}

		let foundInSource = false;
		if (matchedTemplate) {
			foundInSource = matchedTemplate.regex.test(sourceText) || sourceText.toLowerCase().includes(cleanTarget);
		} else if (matchedTransition) {
			const mRegex = new RegExp(`\\b${matchedTransition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
			foundInSource = mRegex.test(sourceText);
		} else if (isSingleWord) {
			const wordRegex = getPatternRegex(cleanTarget);
			foundInSource = wordRegex.test(sourceText);
		} else {
			const phraseRegex = new RegExp(`\\b${cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[- ]+/g, '[- ]+')}\\b`, 'i');
			foundInSource = phraseRegex.test(sourceText);
		}

		if (!foundInSource) {
			errors.push(`reported finding not found in audited source: "${target}"`);
		}

		const claimedTierMatch = /\bTier\s*(1A|1B|2|3)\b/i.exec(f.line);
		if (claimedTierMatch) {
			const claimedTier = claimedTierMatch[1].toUpperCase();
			let expectedTier = cat.tierByPattern.get(cleanTarget);
			if (!expectedTier) {
				for (const bf of targetBases) {
					if (cat.tierByPattern.get(bf)) {
						expectedTier = cat.tierByPattern.get(bf);
						break;
					}
				}
			}
			if (!expectedTier && matchedTemplate) {
				expectedTier = matchedTemplate.tier;
			}
			if (expectedTier && claimedTier !== expectedTier) {
				errors.push(`catalog pattern reported under wrong category: "${target}" is Tier ${expectedTier}, reported under Tier ${claimedTier}`);
			}
		}

		let expectedSeverity = cat.canonicalSeverities.get(cleanTarget);
		if (!expectedSeverity) {
			for (const bf of targetBases) {
				const exp = cat.canonicalSeverities.get(bf);
				if (exp) { expectedSeverity = exp; break; }
			}
		}
		if (!expectedSeverity && matchedTransition) {
			expectedSeverity = 'P2';
		}
		if (!expectedSeverity && matchedTemplate) {
			if (matchedTemplate.tier === 'transition' || matchedTemplate.tier === '2') {
				expectedSeverity = 'P2';
			}
		}
		if (expectedSeverity && f.severity && f.severity !== expectedSeverity) {
			errors.push(`catalog pattern reported under wrong severity: "${target}" is ${expectedSeverity}, reported under ${f.severity}`);
		}

		const isTier2 = (cat.catalogByTier['2'] && (
			cat.catalogByTier['2'].has(cleanTarget) ||
			targetBases.some(bf => cat.catalogByTier['2'].has(bf))
		)) || /\bTier\s*2\b/i.test(f.line);

		if (isTier2) {
			let foundInClusteredPara = false;
			for (let pIdx = 0; pIdx < sourceParagraphs.length; pIdx++) {
				const pMatches = paraTier2Counts[pIdx];
				if (pMatches.length >= 2) {
					const corresponds = pMatches.some(m => {
						const mText = m.match.toLowerCase();
						const mBases = getBaseForms(mText);
						return m.pattern === cleanTarget ||
						       mText === cleanTarget ||
						       mBases.includes(cleanTarget) ||
						       targetBases.includes(m.pattern) ||
						       targetBases.some(tb => mBases.includes(tb));
					});
					if (corresponds) {
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
		errors.push(...validateDetectAudit(fixture, response, catalog));
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

// 15: Missing or malformed sections (Bug 6): responses without required section headings must FAIL
const proseNoSectionsResponse = `We completed the audit. No Issues found during the initial pass, and a separate Assessment is not required.`;
assertFails(detectFixture, proseNoSectionsResponse, 'Issues found', 'response with section keywords only in prose must fail');

// 16: Source-presence validation (Bug 8): catalogued term absent from source must FAIL
const absentTermResponse = `**1. Issues found**\n\n- **P1**: "delve" — Tier 1A marker.\n\n**2. Assessment**\n- "delve" — problem.\n`;
assertFails(detectFixture, absentTermResponse, 'not found in audited source', 'catalogued term absent from source must fail');

// 17: Exact pattern grounding (Bug 9): invented multiword pattern must FAIL
const robustUnicornResponse = `**1. Issues found**\n\n- **P1**: "robust unicorn" — fabricated phrase.\n\n**2. Assessment**\n- Note.\n`;
assertFails(detectFixture, robustUnicornResponse, 'not grounded in pattern catalog', 'invented multiword pattern must fail');

// 18: Transition-section parsing (Bug 5): canonical transition phrases outside skill examples must PASS
const transitionFixture = { ...detectFixture, source: 'Notably, this platform is fast. That said, we continue to test.' };
const transitionResponse = `**1. Issues found**\n\n- **P2**: "Notably" — transition phrase to remove.\n- **P2**: "That said" — transition phrase to remove.\n\n**2. Assessment**\n- Notes.\n`;
assertPasses(transitionFixture, transitionResponse, 'transition phrases outside skill example list must pass');

// 19: Transition alternatives (Bug 12): suggested transition rewrites reported as patterns must FAIL
const transitionAltFixture = { ...detectFixture, source: 'We also deploy changes on top of that.' };
const transitionAltResponse = `**1. Issues found**\n\n- **P2**: "on top of that" — transition phrase.\n\n**2. Assessment**\n- Notes.\n`;
assertFails(transitionAltFixture, transitionAltResponse, 'replacement alternative', 'transition rewrite alternative must fail');

// 20: Transition punctuation (Bug 13): transition phrases quoted with punctuation must PASS and enforce P2
const punctuatedTransitionResponse = `**1. Issues found**\n\n- **P2**: "Moreover," — transition phrase with punctuation.\n\n**2. Assessment**\n- Notes.\n`;
assertPasses(detectFixture, punctuatedTransitionResponse, 'transition phrase quoted with punctuation must pass');

// 21: Severity parsing (Bug 11): invalid severity labels like P10 must FAIL
const p10Response = `**1. Issues found**\n\n- P10: "robust" — Tier 1A marker.\n\n**2. Assessment**\n- Notes.\n`;
assertFails(detectFixture, p10Response, 'canonical severity tier', 'malformed P10 severity must fail');

// 22: Template handling (Bug 10): bare template prefix must FAIL; concrete instantiation must PASS
const truncatedTemplateResponse = `**1. Issues found**\n\n- **P2**: "the integration of" — incomplete template.\n\n**2. Assessment**\n- Notes.\n`;
assertFails(detectFixture, truncatedTemplateResponse, 'not grounded in pattern catalog', 'truncated template fragment must fail');
const templateFixture = { ...detectFixture, source: 'We oversee the integration of services with databases.' };
const templateResponse = `**1. Issues found**\n\n- **P2**: "the integration of services with databases" — template phrase.\n\n**2. Assessment**\n- Notes.\n`;
assertPasses(templateFixture, templateResponse, 'full template instantiation must pass');

// 23: Tier 2 inflections (Bug 14): plural forms must count toward cluster threshold
const t2PluralFixture = { ...detectFixture, source: 'This initiative fosters collaboration and bolsters security across teams.' };
const t2PluralResponse = `**1. Issues found**\n\n- **P2**: "fosters" — Tier 2 cluster.\n- **P2**: "bolsters" — Tier 2 cluster.\n\n**2. Assessment**\n- Both terms form a cluster.\n`;
assertPasses(t2PluralFixture, t2PluralResponse, 'Tier 2 plural inflections in same paragraph must pass');

// 24: Report parsing (Bug 15): intro prose and Tier 1B subheadings must PASS
const introProseResponse = `**1. Issues found**\n\nThe following issues were identified during model-only audit:\n\n**Tier 1A**\n- **P1**: "robust" — AI frequency marker.\n\n**Tier 1B clarity edits**\n\n**2. Assessment**\n- "robust" — clear problem.\n`;
assertPasses(detectFixture, introProseResponse, 'introductory prose and subheadings in Issues found must pass');

// 25: Quoted source text separation (Requirement Gap 1): quote containing replacement words or testament to must PASS
const quoteWithReplacementResponse = `**1. Issues found**\n\n- **P1**: "robust" (in "this robust platform unlocks efficiency") — Tier 1A marker.\n\n**2. Assessment**\n- Notes.\n`;
assertPasses(detectFixture, quoteWithReplacementResponse, 'valid finding quoting source span containing replacement word must pass');
const testamentFixture = { ...detectFixture, source: 'This architecture is a testament to careful engineering.' };
const testamentResponse = `**1. Issues found**\n\n- **P1**: "testament to" — catalog phrase.\n\n**2. Assessment**\n- Notes.\n`;
assertPasses(testamentFixture, testamentResponse, 'catalog phrase testament to must pass');

// 26: Claimed categories validation (Requirement Gap 2): wrong tier category claim must FAIL
const wrongCategoryResponse = `**1. Issues found**\n\n- **P1 (Tier 1B clarity edit):** "robust" — clarity edit.\n\n**2. Assessment**\n- Notes.\n`;
assertFails(detectFixture, wrongCategoryResponse, 'wrong category', 'finding claiming incorrect tier category must fail');

// 27: Tier 2 context exceptions (Requirement Gap 3): exempt literal use inside otherwise valid cluster must FAIL
const exemptTier2Fixture = { ...detectFixture, source: 'We harness the power to streamline deeply nested logic.' };
const exemptTier2Response = `**1. Issues found**\n\n- **P2**: "deeply nested" — Tier 2 finding.\n- **P2**: "harness" — Tier 2 finding.\n- **P2**: "streamline" — Tier 2 finding.\n\n**2. Assessment**\n- Notes.\n`;
assertFails(exemptTier2Fixture, exemptTier2Response, 'sub-threshold Tier 2', 'exempt Tier 2 use inside cluster must fail');

// 28: Severity consistency (Bug 7): generic conclusions like "The future looks bright" are canonical P2
const conclusionFixture = { ...detectFixture, source: 'The future looks bright for the project.' };
const conclusionP2Response = `**1. Issues found**\n\n- **P2**: "The future looks bright" — generic conclusion.\n\n**2. Assessment**\n- Notes.\n`;
assertPasses(conclusionFixture, conclusionP2Response, 'generic conclusion under P2 must pass');
const conclusionP1Response = `**1. Issues found**\n\n- **P1**: "The future looks bright" — generic conclusion.\n\n**2. Assessment**\n- Notes.\n`;
assertFails(conclusionFixture, conclusionP1Response, 'wrong severity', 'generic conclusion under P1 must fail');

console.log(JSON.stringify({ response_file: path.basename(responseFile), results, mutation_controls: '28 passed', note: 'Literal invariants only. Semantic fidelity and truthful reporting require the separate independent model assessment.' }, null, 2));
if (results.some(r => r.errors.length)) process.exitCode = 1;
