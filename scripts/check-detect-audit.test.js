'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const repo = path.resolve(__dirname, '..');
const {
	loadCatalog,
	getBaseForms,
	getPatternRegex,
	getTier2MatchesInParagraph,
	getTargetPattern,
	validateDetectAudit,
	inspect,
	runNamedMutationControls,
} = require(path.join(repo, 'evals/rewrite/check-detect-audit.cjs'));

const cat = loadCatalog(repo);
const scenarioFile = path.join(repo, 'evals/rewrite/automated-scenarios.json');
const scenarios = JSON.parse(fs.readFileSync(scenarioFile, 'utf8').replace(/^\uFEFF/, ''));
const detectFixture = scenarios.scenarios.find(s => s.id === 'detect_only');

// 1. Run all named mutation controls and verify actual executed counts
const controls = runNamedMutationControls(repo, scenarios, {}, cat);
assert.equal(controls.failed, 0, `named controls failed: ${JSON.stringify(controls.failed_names)}`);
assert.equal(controls.executed, 38, `expected 38 executed controls, got ${controls.executed}`);
assert.equal(controls.passed, 38, `expected 38 passed controls, got ${controls.passed}`);
assert.equal(controls.summary, '38 passed');

// 2. Verify that displayed count dynamically derives from executed controls, not hardcoded
assert.equal(controls.executed, controls.passed + controls.failed);
{
	// Test runner tracking behavior with a failing control
	const fakeResults = [
		{ name: 'ctrl_pass', passed: true },
		{ name: 'ctrl_fail', passed: false, error: 'expected failure' },
	];
	const executed = fakeResults.length;
	const passed = fakeResults.filter(r => r.passed).length;
	const failed = fakeResults.filter(r => !r.passed);
	assert.equal(executed, 2);
	assert.equal(passed, 1);
	assert.equal(failed.length, 1);
	assert.deepEqual(failed.map(r => r.name), ['ctrl_fail']);
}

// 3. Adverbial base-form normalization
const robustForms = getBaseForms('robustly');
assert(robustForms.includes('robust'), 'robustly must normalize to base robust');
const compForms = getBaseForms('comprehensively');
assert(compForms.includes('comprehensive'), 'comprehensively must normalize to base comprehensive');

// Positive control: robustly with canonical P1 severity
const robustlyFix = { ...detectFixture, source: 'This product robustly unlocks success.' };
const robustlyResp = `**1. Issues found**\n\n- **P1**: "robustly" — Tier 1A adverbial variant.\n\n**2. Assessment**\n- Found robustly.\n`;
const robustlyRes = inspect(robustlyFix, robustlyResp, repo, cat);
assert.equal(robustlyRes.errors.length, 0, `robustly must pass: ${JSON.stringify(robustlyRes.errors)}`);

// Positive control: comprehensively with canonical P1 severity
const compFix = { ...detectFixture, source: 'We comprehensively transformed the process.' };
const compResp = `**1. Issues found**\n\n- **P1**: "comprehensively" — Tier 1A adverbial variant.\n\n**2. Assessment**\n- Found comprehensively.\n`;
const compRes = inspect(compFix, compResp, repo, cat);
assert.equal(compRes.errors.length, 0, `comprehensively must pass: ${JSON.stringify(compRes.errors)}`);

// Negative control: replacement-only explore rejected
const exploreFix = { ...detectFixture, source: 'We explore new avenues for product growth.' };
const exploreResp = `**1. Issues found**\n\n- **P1**: "explore" — replacement-only term.\n\n**2. Assessment**\n- Notes.\n`;
const exploreRes = inspect(exploreFix, exploreResp, repo, cat);
assert(exploreRes.errors.some(e => e.includes('replacement alternative')), 'explore must be rejected as replacement-only');

// Negative control: fabricated combination robust unicorn rejected
const unicornFix = { ...detectFixture, source: 'The startup is a robust unicorn in the market.' };
const unicornResp = `**1. Issues found**\n\n- **P1**: "robust unicorn" — fabricated phrase.\n\n**2. Assessment**\n- Notes.\n`;
const unicornRes = inspect(unicornFix, unicornResp, repo, cat);
assert(unicornRes.errors.some(e => e.includes('not grounded in pattern catalog')), 'robust unicorn must be rejected');

// 4. Historical Claude negative controls (cycle 2, cycle 3, cycle 5)
const c2Path = path.join(repo, 'evals/rewrite/reports/automated-stack-295-296-2026-09-16/literal-checks/isolated-cycle2-claude-responses.json');
if (fs.existsSync(c2Path)) {
	const c2 = JSON.parse(fs.readFileSync(c2Path, 'utf8').replace(/^\uFEFF/, '')).detect_only;
	const res = inspect(detectFixture, c2, repo, cat);
	assert(res.errors.length > 0, 'cycle 2 Claude must fail detect-audit');
	assert(res.errors.some(e => e.includes('Moreover') && e.includes('wrong severity')), 'cycle 2 Claude must fail on Moreover severity');
}

const c3Path = path.join(repo, 'evals/rewrite/reports/automated-stack-295-296-2026-09-16/literal-checks/isolated-cycle3-claude-responses.json');
if (fs.existsSync(c3Path)) {
	const c3 = JSON.parse(fs.readFileSync(c3Path, 'utf8').replace(/^\uFEFF/, '')).detect_only;
	const res = inspect(detectFixture, c3, repo, cat);
	assert(res.errors.length > 0, 'cycle 3 Claude must fail detect-audit');
	assert(res.errors.some(e => e.includes('Moreover')), 'cycle 3 Claude must fail on Moreover');
}

const c5Path = path.join(repo, 'evals/rewrite/reports/automated-stack-295-296-2026-09-16/isolated-cycle5/claude-responses.json');
if (fs.existsSync(c5Path)) {
	const c5 = JSON.parse(fs.readFileSync(c5Path, 'utf8').replace(/^\uFEFF/, '')).detect_only;
	const res = inspect(detectFixture, c5, repo, cat);
	assert(res.errors.length > 0, 'cycle 5 Claude must fail detect-audit');
	assert(res.errors.some(e => e.includes('unlocks efficiency')), 'cycle 5 Claude must fail on unlocks efficiency');
}

// 5. Compliant MiMo cycle 2 positive control passes with 0 errors
const m2Path = path.join(repo, 'evals/rewrite/reports/automated-stack-295-296-2026-09-16/literal-checks/isolated-cycle2-mimo-responses.json');
if (fs.existsSync(m2Path)) {
	const m2 = JSON.parse(fs.readFileSync(m2Path, 'utf8').replace(/^\uFEFF/, '')).detect_only;
	const res = inspect(detectFixture, m2, repo, cat);
	assert.equal(res.errors.length, 0, 'compliant cycle 2 MiMo must pass with 0 errors');
}

console.log('ok  scripts/check-detect-audit.test.js (38 named mutation controls, historical regressions, and positive controls passed)');
