// Standalone current detect-audit and literal invariant checker (PR #394 / Issue #323).
// Validates model-only detect audits against actual pattern catalog, canonical severities,
// Tier 2 paragraph thresholds, and catalog-grounded adverbial base forms.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

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
	if (word.endsWith('ly')) {
		forms.add(word.slice(0, -2));
		if (word.endsWith('ily')) forms.add(word.slice(0, -3) + 'y');
		if (word.endsWith('ally')) forms.add(word.slice(0, -4));
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
			if (!foundInSource) {
				for (const bf of targetBases) {
					if (cat.allCatalogWords.has(bf)) {
						const bfRegex = getPatternRegex(bf);
						if (bfRegex.test(sourceText) || sourceText.toLowerCase().includes(cleanTarget)) {
							foundInSource = true;
							break;
						}
					}
				}
			}
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

function inspect(fixture, response, repo, cat) {
	response = response.replace(/^\uFEFF/, '');
	const errors = [];
	const matches = [...response.matchAll(heading)];
	if (fixture.expect.no_final_rewrite) {
		if (matches.length) errors.push('detect response contains a Final rewrite');
		errors.push(...validateDetectAudit(fixture, response, cat));
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

	const { validate } = require(path.join(path.resolve(repo), 'detector/validate.js'));
	const preservation = validate(fixture.source, final, { skipResidual: true });
	if (!preservation.ok) errors.push('deterministic preservation failed');
	return { id: fixture.id, final, errors, preservation };
}

function runNamedMutationControls(repo, fixtures, responses, cat) {
	const results = [];
	const detectFixture = fixtures.scenarios.find(f => f.id === 'detect_only') || {
		id: 'detect_only',
		source: 'Acme is a robust platform that unlocks efficiency. Delve into the data.',
		expect: { no_final_rewrite: true },
	};
	const noopFixture = fixtures.scenarios.find(f => f.id === 'noop');
	const protectedFixture = fixtures.scenarios.find(f => f.id === 'protected');

	function register(name, fn) {
		try {
			fn();
			results.push({ name, passed: true });
		} catch (err) {
			results.push({ name, passed: false, error: err.message });
		}
	}

	function assertPasses(fix, resp, label) {
		const res = inspect(fix, resp, repo, cat);
		assert.equal(res.errors.length, 0, `${label}: unexpected errors: ${JSON.stringify(res.errors)}`);
	}

	function assertFails(fix, resp, errSubstr, label) {
		const res = inspect(fix, resp, repo, cat);
		assert(res.errors.length > 0, `${label}: expected errors but got 0`);
		if (errSubstr) {
			assert(res.errors.some(e => e.includes(errSubstr)), `${label}: expected error matching "${errSubstr}", got: ${JSON.stringify(res.errors)}`);
		}
	}

	// 1: Protected literal URL mutation must fail
	register('protected_exact_mutation', () => {
		if (protectedFixture && responses && responses.protected) {
			const res = inspect(protectedFixture, responses.protected.replaceAll('https://status.example.test/v2', 'https://wrong.example/v3'), repo, cat);
			assert(res.errors.length > 0, 'mutated URL must fail');
		}
	});

	// 2: No-op source change mutation must fail
	register('noop_source_mutation', () => {
		if (noopFixture && responses && responses.noop) {
			const res = inspect(noopFixture, responses.noop.replace('The migration starts Tuesday.', 'The migration starts Wednesday.'), repo, cat);
			assert(res.errors.length > 0, 'mutated noop source must fail');
		}
	});

	// 3: BOM in no-op must be tolerated
	register('noop_bom_preservation', () => {
		if (noopFixture && responses && responses.noop) {
			const res = inspect(noopFixture, '\uFEFF' + responses.noop.replace(/^\uFEFF/, ''), repo, cat);
			assert.equal(res.errors.length, 0, 'BOM must be ignored');
		}
	});

	// 4: Separator before verification must be tolerated
	register('noop_separator_preservation', () => {
		if (noopFixture && responses && responses.noop) {
			const res = inspect(noopFixture, responses.noop.replace(/(\n(?:## |\*\*)Verification)/, '\n\n---\n$1'), repo, cat);
			assert.equal(res.errors.length, 0, 'separator before verification must pass');
		}
	});

	// 5: Detect mode Final rewrite rejection
	register('detect_final_rewrite_mutation', () => {
		const res = inspect(detectFixture, (responses?.detect_only || '# Issues found\n- None\n# Assessment\nClean.') + '\nFinal rewrite\nChanged source.', repo, cat);
		assert(res.errors.length > 0, 'Final rewrite in detect mode must fail');
	});

	// 6: Missing detect sections rejection
	register('detect_missing_sections', () => {
		assertFails(detectFixture, 'Just some model output without sections.', 'missing or malformed Issues found section', 'missing detect sections must fail');
		assertFails(detectFixture, 'We checked issues found in our assessment of the document.', 'missing or malformed Issues found section', 'keywords only in prose must fail');
	});

	// 7: Grounded Tier 1A positive control "robust"
	register('detect_valid_grounded_pattern_robust', () => {
		const resp = `**1. Issues found**\n\n- **P1**: "robust" — Tier 1A frequency marker.\n\n**2. Assessment**\n- Clear issue.\n`;
		assertPasses(detectFixture, resp, 'grounded catalog pattern robust must pass');
	});

	// 8: Grounded Tier 1A positive control "delve"
	register('detect_valid_grounded_pattern_delve', () => {
		const fix = { ...detectFixture, source: 'Delve into the platform metrics.' };
		const resp = `**1. Issues found**\n\n- **P1**: "delve" — Tier 1A frequency marker.\n\n**2. Assessment**\n- Clear issue.\n`;
		assertPasses(fix, resp, 'grounded catalog pattern delve must pass');
	});

	// 9: Catalog-defined variant "meticulously"
	register('detect_valid_variant_meticulously', () => {
		const fix = { ...detectFixture, source: 'The system was meticulously verified by engineers.' };
		const resp = `**1. Issues found**\n\n- **P1**: "meticulously" — Tier 1A adverbial variant.\n\n**2. Assessment**\n- Notes.\n`;
		assertPasses(fix, resp, 'meticulously must pass');
	});

	// 10: Catalog-defined variant "genuinely"
	register('detect_valid_variant_genuinely', () => {
		const fix = { ...detectFixture, source: 'The platform is genuinely innovative in its design.' };
		const resp = `**1. Issues found**\n\n- **P1**: "genuinely" — Tier 1A variant.\n\n**2. Assessment**\n- Notes.\n`;
		assertPasses(fix, resp, 'genuinely must pass');
	});

	// 11: Valid adverbial variant "robustly"
	register('detect_valid_adverbial_robustly', () => {
		const fix = { ...detectFixture, source: 'This product robustly unlocks success.' };
		const resp = `**1. Issues found**\n\n- **P1**: "robustly" — Tier 1A adverbial variant.\n\n**2. Assessment**\n- Found robustly in source.\n`;
		assertPasses(fix, resp, 'robustly from source must pass with P1');
	});

	// 12: Valid adverbial variant "comprehensively"
	register('detect_valid_adverbial_comprehensively', () => {
		const fix = { ...detectFixture, source: 'We comprehensively transformed the process.' };
		const resp = `**1. Issues found**\n\n- **P1**: "comprehensively" — Tier 1A adverbial variant.\n\n**2. Assessment**\n- Found comprehensively in source.\n`;
		assertPasses(fix, resp, 'comprehensively from source must pass with P1');
	});

	// 13: Replacement-only "explore" rejection
	register('detect_replacement_only_explore', () => {
		const fix = { ...detectFixture, source: 'We explore new avenues for product growth.' };
		const resp = `**1. Issues found**\n\n- **P1**: "explore" — replacement-only term.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(fix, resp, 'replacement alternative', 'replacement-only word explore must fail');
	});

	// 14: Fabricated combination "robust unicorn" rejection
	register('detect_fabricated_phrase_robust_unicorn', () => {
		const fix = { ...detectFixture, source: 'The startup is a robust unicorn in the market.' };
		const resp = `**1. Issues found**\n\n- **P1**: "robust unicorn" — fabricated phrase.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(fix, resp, 'not grounded in pattern catalog', 'fabricated combination robust unicorn must fail');
	});

	// 15: Source absence rejection
	register('detect_hallucinated_source_unleash', () => {
		const resp = `**1. Issues found**\n\n- **P2**: "unleash" — not in source.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(detectFixture, resp, 'not found in audited source', 'pattern absent from source must fail');
	});

	// 16: Severity mismatch P1 for P2 pattern
	register('detect_severity_mismatch_p1_for_p2', () => {
		const fix = { ...detectFixture, source: 'Moreover, this platform is reliable.' };
		const resp = `**1. Issues found**\n\n- **P1**: "Moreover" — reported under P1 instead of P2.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(fix, resp, 'wrong severity', 'P2 pattern reported under P1 must fail');
	});

	// 17: Severity mismatch P2 for P1 pattern
	register('detect_severity_mismatch_p2_for_p1', () => {
		const resp = `**1. Issues found**\n\n- **P2**: "robust" — reported under P2 instead of P1.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(detectFixture, resp, 'wrong severity', 'P1 pattern reported under P2 must fail');
	});

	// 18: Invalid severity label P10 rejection
	register('detect_invalid_severity_label_p10', () => {
		const resp = `**1. Issues found**\n\n- P10: "robust" — Tier 1A marker.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(detectFixture, resp, 'missing canonical severity tier', 'malformed P10 severity must fail');
	});

	// 19: Tier 2 single occurrence sub-threshold rejection
	register('detect_tier2_single_occurrence_subthreshold', () => {
		const fix = { ...detectFixture, source: 'We streamline the process for clients.' };
		const resp = `**1. Issues found**\n\n- **P2**: "streamline" — single Tier 2 use.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(fix, resp, 'sub-threshold Tier 2', 'isolated Tier 2 match must fail');
	});

	// 20: Tier 2 clustered occurrences pass
	register('detect_tier2_clustered_occurrences', () => {
		const fix = { ...detectFixture, source: 'We streamline the deployment and harness the existing pipeline.' };
		const resp = `**1. Issues found**\n\n- **P2**: "streamline" — Tier 2 cluster.\n- **P2**: "harness" — Tier 2 cluster.\n\n**2. Assessment**\n- Notes.\n`;
		assertPasses(fix, resp, 'clustered Tier 2 occurrences must pass');
	});

	// 21: Tier 2 across different paragraphs sub-threshold rejection
	register('detect_tier2_different_paragraphs_subthreshold', () => {
		const fix = { ...detectFixture, source: 'Paragraph one streamlines the deployment.\n\nParagraph two harnesses the telemetry.' };
		const resp = `**1. Issues found**\n\n- **P2**: "streamlines" — spread across paragraphs.\n- **P2**: "harnesses" — spread across paragraphs.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(fix, resp, 'sub-threshold Tier 2', 'Tier 2 spread across paragraphs must fail');
	});

	// 22: Tier 2 exempt context rejection
	register('detect_tier2_exempt_context', () => {
		const fix = { ...detectFixture, source: 'We harness the power to streamline deeply nested logic.' };
		const resp = `**1. Issues found**\n\n- **P2**: "deeply nested" — Tier 2 finding.\n- **P2**: "harness" — Tier 2 finding.\n- **P2**: "streamline" — Tier 2 finding.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(fix, resp, 'sub-threshold Tier 2', 'exempt Tier 2 usage inside cluster must fail');
	});

	// 23: Tier 2 plural inflections pass
	register('detect_tier2_plural_inflections', () => {
		const fix = { ...detectFixture, source: 'This initiative fosters collaboration and bolsters security across teams.' };
		const resp = `**1. Issues found**\n\n- **P2**: "fosters" — Tier 2 cluster.\n- **P2**: "bolsters" — Tier 2 cluster.\n\n**2. Assessment**\n- Notes.\n`;
		assertPasses(fix, resp, 'Tier 2 plural inflections in same paragraph must pass');
	});

	// 24: Transition phrases outside skill examples pass
	register('detect_transition_phrases_valid', () => {
		const fix = { ...detectFixture, source: 'Notably, this platform is fast. That said, we continue to test.' };
		const resp = `**1. Issues found**\n\n- **P2**: "Notably" — transition phrase.\n- **P2**: "That said" — transition phrase.\n\n**2. Assessment**\n- Notes.\n`;
		assertPasses(fix, resp, 'canonical transition phrases must pass under P2');
	});

	// 25: Transition rewrite alternative rejected
	register('detect_transition_alternative_rejected', () => {
		const fix = { ...detectFixture, source: 'We also deploy changes on top of that.' };
		const resp = `**1. Issues found**\n\n- **P2**: "on top of that" — transition phrase alternative.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(fix, resp, 'replacement alternative', 'transition rewrite alternative must fail');
	});

	// 26: Transition punctuation handled
	register('detect_transition_punctuation_handled', () => {
		const resp = `**1. Issues found**\n\n- **P2**: "Moreover," — transition phrase with comma.\n\n**2. Assessment**\n- Notes.\n`;
		assertPasses(detectFixture, resp, 'transition phrase with comma must pass');
	});

	// 27: Incomplete template fragment rejected
	register('detect_template_incomplete_fragment', () => {
		const resp = `**1. Issues found**\n\n- **P2**: "the integration of" — incomplete template.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(detectFixture, resp, 'not grounded in pattern catalog', 'truncated template fragment must fail');
	});

	// 28: Full template instantiation passes
	register('detect_template_full_instantiation', () => {
		const fix = { ...detectFixture, source: 'We oversee the integration of services with databases.' };
		const resp = `**1. Issues found**\n\n- **P2**: "the integration of services with databases" — template phrase.\n\n**2. Assessment**\n- Notes.\n`;
		assertPasses(fix, resp, 'full template instantiation must pass');
	});

	// 29: Report intro prose and subheadings pass
	register('detect_report_intro_prose_and_subheadings', () => {
		const resp = `**1. Issues found**\n\nThe following issues were identified during model-only audit:\n\n**Tier 1A**\n- **P1**: "robust" — AI frequency marker.\n\n**Tier 1B clarity edits**\n\n**2. Assessment**\n- "robust" — clear problem.\n`;
		assertPasses(detectFixture, resp, 'introductory prose and subheadings in Issues found must pass');
	});

	// 30: Quoted evidence containing replacement words passes
	register('detect_quoted_evidence_with_replacement_words', () => {
		const resp = `**1. Issues found**\n\n- **P1**: "robust" (in "this robust platform unlocks efficiency") — Tier 1A marker.\n\n**2. Assessment**\n- Notes.\n`;
		assertPasses(detectFixture, resp, 'valid finding quoting context with replacement word must pass');
	});

	// 31: Multiword catalog phrase "testament to" passes
	register('detect_catalog_phrase_testament_to', () => {
		const fix = { ...detectFixture, source: 'This architecture is a testament to careful engineering.' };
		const resp = `**1. Issues found**\n\n- **P1**: "testament to" — catalog phrase.\n\n**2. Assessment**\n- Notes.\n`;
		assertPasses(fix, resp, 'testament to must pass');
	});

	// 32: Incorrect tier category claim rejected
	register('detect_wrong_category_claim', () => {
		const resp = `**1. Issues found**\n\n- **P1 (Tier 1B clarity edit):** "robust" — clarity edit.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(detectFixture, resp, 'reported under Tier 1B', 'finding claiming wrong tier category must fail');
	});

	// 33: Generic conclusion under P2 passes
	register('detect_generic_conclusion_p2_valid', () => {
		const fix = { ...detectFixture, source: 'The future looks bright for the project.' };
		const resp = `**1. Issues found**\n\n- **P2**: "The future looks bright" — generic conclusion.\n\n**2. Assessment**\n- Notes.\n`;
		assertPasses(fix, resp, 'generic conclusion under P2 must pass');
	});

	// 34: Generic conclusion under P1 rejected
	register('detect_generic_conclusion_p1_invalid', () => {
		const fix = { ...detectFixture, source: 'The future looks bright for the project.' };
		const resp = `**1. Issues found**\n\n- **P1**: "The future looks bright" — generic conclusion.\n\n**2. Assessment**\n- Notes.\n`;
		assertFails(fix, resp, 'wrong severity', 'generic conclusion under P1 must fail');
	});

	// 35: Historical cycle2 Claude negative control — audit violations detected
	register('detect_historical_claude_cycle2_regression', () => {
		const c2File = path.join(path.resolve(repo), 'evals/rewrite/reports/automated-stack-295-296-2026-09-16/literal-checks/isolated-cycle2-claude-responses.json');
		if (fs.existsSync(c2File)) {
			const c2Resp = JSON.parse(fs.readFileSync(c2File, 'utf8').replace(/^\uFEFF/, '')).detect_only;
			const res = inspect(detectFixture, c2Resp, repo, cat);
			assert(res.errors.length > 0, 'historical cycle2 Claude must be flagged for audit violations');
			assert(res.errors.some(e => e.includes('wrong severity') && e.includes('Moreover')), 'must flag Moreover wrong severity');
		}
	});

	// 36: Historical cycle3 Claude negative control — audit violations detected
	register('detect_historical_claude_cycle3_regression', () => {
		const c3File = path.join(path.resolve(repo), 'evals/rewrite/reports/automated-stack-295-296-2026-09-16/literal-checks/isolated-cycle3-claude-responses.json');
		if (fs.existsSync(c3File)) {
			const c3Resp = JSON.parse(fs.readFileSync(c3File, 'utf8').replace(/^\uFEFF/, '')).detect_only;
			const res = inspect(detectFixture, c3Resp, repo, cat);
			assert(res.errors.length > 0, 'historical cycle3 Claude must be flagged for audit violations');
			assert(res.errors.some(e => e.includes('Moreover')), 'must flag Moreover wrong severity');
		}
	});

	// 37: Historical cycle5 Claude negative control — audit violations detected
	register('detect_historical_claude_cycle5_regression', () => {
		const c5File = path.join(path.resolve(repo), 'evals/rewrite/reports/automated-stack-295-296-2026-09-16/isolated-cycle5/claude-responses.json');
		if (fs.existsSync(c5File)) {
			const c5Resp = JSON.parse(fs.readFileSync(c5File, 'utf8').replace(/^\uFEFF/, '')).detect_only;
			const res = inspect(detectFixture, c5Resp, repo, cat);
			assert(res.errors.length > 0, 'historical cycle5 Claude must be flagged for audit violations');
			assert(res.errors.some(e => e.includes('unlocks efficiency')), 'must flag unlocks efficiency ungrounded');
		}
	});

	// 38: Compliant MiMo cycle2 positive control — passes with 0 errors
	register('detect_mimo_cycle2_compliant_passes', () => {
		const m2File = path.join(path.resolve(repo), 'evals/rewrite/reports/automated-stack-295-296-2026-09-16/literal-checks/isolated-cycle2-mimo-responses.json');
		if (fs.existsSync(m2File)) {
			const m2Resp = JSON.parse(fs.readFileSync(m2File, 'utf8').replace(/^\uFEFF/, '')).detect_only;
			const res = inspect(detectFixture, m2Resp, repo, cat);
			assert.equal(res.errors.length, 0, 'compliant cycle2 MiMo detect response must pass with 0 errors');
		}
	});

	const executed = results.length;
	const passed = results.filter(r => r.passed).length;
	const failed = results.filter(r => !r.passed);

	return {
		executed,
		passed,
		failed: failed.length,
		failed_names: failed.map(r => r.name),
		summary: `${passed} passed`,
		results,
	};
}

function runCli() {
	const args = process.argv.slice(2);
	if (args.length < 3) {
		console.error('Usage: node check-detect-audit.cjs <repoPath> <fixturesFile> <responsesFile>');
		process.exit(1);
	}
	const [repo, fixtureFile, responseFile] = args;
	const cat = loadCatalog(repo);
	const fixtures = JSON.parse(fs.readFileSync(fixtureFile, 'utf8').replace(/^\uFEFF/, ''));
	const responses = JSON.parse(fs.readFileSync(responseFile, 'utf8').replace(/^\uFEFF/, ''));

	const results = fixtures.scenarios.map(f => inspect(f, responses[f.id] || '', repo, cat));
	const mutationControls = runNamedMutationControls(repo, fixtures, responses, cat);

	const output = {
		response_file: path.basename(responseFile),
		results,
		mutation_controls: {
			total: mutationControls.executed,
			passed: mutationControls.passed,
			failed: mutationControls.failed,
			failed_controls: mutationControls.failed_names,
			summary: mutationControls.summary,
		},
		note: 'Current detect-audit invariants (#323). Validates catalog grounding, canonical severities, and Tier 2 paragraph thresholds.',
	};

	console.log(JSON.stringify(output, null, 2));
	if (results.some(r => r.errors.length) || mutationControls.failed > 0) {
		process.exitCode = 1;
	}
}

if (require.main === module) {
	runCli();
}

module.exports = {
	loadCatalog,
	getBaseForms,
	getPatternRegex,
	getTier2MatchesInParagraph,
	getTargetPattern,
	validateDetectAudit,
	inspect,
	runNamedMutationControls,
};
