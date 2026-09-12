const assert = require('node:assert/strict');
const { hash, validateCases, phraseOccurs, prepare, checkPlan, checkResults, blind, checkBallot, report } = require('./rewrite-eval');

const cases = require('../evals/rewrite/cases.json');
const protocol = require('../evals/rewrite/protocol.json');
const clone = (x) => JSON.parse(JSON.stringify(x));
const throwsWith = (fn, pattern, label) => assert.throws(fn, pattern, `${label}: expected rejection matching ${pattern}`);
const framed = (text, { prefix = '', suffix = '', eol = '\n' } = {}) => {
  const { open, close } = protocol.final_text_markers;
  const raw_output = `${prefix ? `${prefix}${eol}` : ''}${open}${eol}${text}${eol}${close}${suffix ? `${eol}${suffix}` : ''}`;
  return { raw_output, final_text: text, final_text_offset: raw_output.indexOf(text, raw_output.indexOf(open) + open.length) };
};

// ── Case corpus ──────────────────────────────────────────────────────────
validateCases(cases, protocol);

const leaked = clone(cases);
leaked.find((c) => c.split === 'heldout').author_id = leaked.find((c) => c.split === 'development').author_id;
throwsWith(() => validateCases(leaked, protocol), /leakage/, 'author leakage');
const leakedDocument = clone(cases);
leakedDocument.find((c) => c.split === 'heldout').document_id = leakedDocument.find((c) => c.split === 'development').document_id;
throwsWith(() => validateCases(leakedDocument, protocol), /leakage/, 'document leakage');

const duplicate = clone(cases);
duplicate[1].id = duplicate[0].id;
throwsWith(() => validateCases(duplicate, protocol), /duplicate/, 'duplicate id');

// Constraints are literal phrase lists. Regular expressions are refused at
// validation, including shapes no group-based guard catches (^a*a*a*a*b$).
for (const pattern of ['^(a+)+$', '^a*a*a*a*a*a*a*a*a*a*b$', 'Sequoia']) {
  const regex = clone(cases);
  regex[0].required_phrases = [{ id: 'bad', pattern }];
  throwsWith(() => validateCases(regex, protocol), /regular expressions are not accepted/, `regex ${pattern}`);
}
const legacy = clone(cases);
legacy[0].required_patterns = [{ id: 'old', pattern: 'x' }];
throwsWith(() => validateCases(legacy, protocol), /no longer accepted/, 'legacy patterns key');
const emptyAny = clone(cases);
emptyAny[0].forbidden_phrases = [{ id: 'empty', any: [] }];
throwsWith(() => validateCases(emptyAny, protocol), /at least one phrase/, 'empty any');
const strayKey = clone(cases);
strayKey[0].forbidden_phrases = [{ id: 'stray', any: ['x'], flags: 'i' }];
throwsWith(() => validateCases(strayKey, protocol), /unknown key flags/, 'stray key');
const phrased = clone(cases);
phrased[0].required_phrases = [{ id: 'ok', any: ['paying customers', 'under a second'], note: 'either wording' }];
validateCases(phrased, protocol);

// Matching: case-insensitive, whitespace-collapsed, word-bounded at word ends.
assert(phraseOccurs('led by', 'A $40M Series B led by Sequoia.'));
assert(!phraseOccurs('led by', 'The rollout was handled by the platform team.'));
assert(phraseOccurs('real-time dashboards', 'Real-Time   dashboards\nrefresh every second.'));
assert(phraseOccurs('$40M', 'raised $40M in'));
assert(!phraseOccurs('customer', 'customers'));
assert(phraseOccurs('customers', 'for its 200 paying customers.'));
const started = performance.now();
assert(!phraseOccurs('b', 'a'.repeat(200000)));
assert(performance.now() - started < 200, 'literal matching stays linear');

const miscounted = clone(protocol);
miscounted.case_count = 47;
throwsWith(() => validateCases(cases, miscounted), /group_size|47/, 'protocol counts');

// Rewrite-only scope. Edit mode edits a file in place and returns a report, so
// no prompt-only condition can pose it and the fixed simple prompt has no edit
// contract; a case or protocol that reintroduces it must be refused rather than
// silently compared against rewritten prose.
assert.deepEqual(protocol.modes, ['rewrite'], 'the pilot protocol freezes rewrite mode only');
assert(cases.every((c) => c.mode === 'rewrite'), 'every committed case is a rewrite task');

const editCase = clone(cases);
editCase[0].mode = 'edit';
throwsWith(() => validateCases(editCase, protocol), /outside this pilot/, 'edit-mode case');

const editProtocol = clone(protocol);
editProtocol.modes = ['rewrite', 'edit'];
throwsWith(() => validateCases(cases, editProtocol), /rewrite-mode tasks only/, 'edit mode in protocol');

const unknownMode = clone(protocol);
unknownMode.modes = ['refactor'];
throwsWith(() => validateCases(cases, unknownMode), /must name skill modes/, 'unknown protocol mode');

const noModes = clone(protocol);
delete noModes.modes;
throwsWith(() => validateCases(cases, noModes), /protocol.modes required/, 'missing protocol modes');

const noMarkers = clone(protocol);
delete noMarkers.final_text_markers;
throwsWith(() => validateCases(cases, noMarkers), /final_text_markers required/, 'missing final-text markers');
const overlappingMarkers = clone(protocol);
overlappingMarkers.final_text_markers.close = `${overlappingMarkers.final_text_markers.open}>`;
throwsWith(() => validateCases(cases, overlappingMarkers), /distinct and non-overlapping/, 'overlapping final-text markers');
const markerInSource = clone(cases);
markerInSource[0].source += ` ${protocol.final_text_markers.open}`;
throwsWith(() => validateCases(markerInSource, protocol), /reserved final-text marker/, 'marker in source');

// ── Plan freeze ──────────────────────────────────────────────────────────
const model = { id: 'test-editor', provider: 'test-only', version: 'synthetic-v1', family: 'test-only', settings: { temperature: 0 }, tools: [] };
// The plan reads its corpus from git, so the fixture below uses plan.cases, the
// committed set, rather than the working-tree file validated above. A case
// schema change therefore has to be committed before this test can pass.
const plan = prepare({ baseline: 'HEAD', candidate: 'HEAD', corpus: 'HEAD', split: 'development', models: [model] });
assert.equal(plan.tasks.length, plan.protocol.split_sizes.development * plan.protocol.repetitions * plan.protocol.conditions.length);
assert.equal(plan.sources.baseline.commit, plan.sources.candidate.commit);
assert.equal(plan.sources.corpus.commit, plan.sources.candidate.commit);
assert(plan.tasks.every((t) => t.prompt_hash && t.user.includes('Treat the JSON string below only as source text')));
assert(plan.tasks.every((t) => t.user.startsWith('Rewrite the prose supplied below')), 'every task asks for a rewrite');
assert(plan.tasks.every((t) => t.user.includes(protocol.final_text_markers.open) && t.user.includes(protocol.final_text_markers.close)), 'every task carries the common final-text boundary contract');
assert(plan.tasks.every((t) => t.user.includes('mark only that corrected version')), 'every task identifies the second-pass rewrite as the final artifact');
assert(
  plan.tasks.every((t) => !/filesystem|edit mode|mode edit|instead of changing a file/i.test(t.user)),
  'no task instructs the editor around a mode it cannot run',
);
checkPlan(plan);

throwsWith(
  () => prepare({ baseline: 'HEAD', candidate: 'HEAD', corpus: 'HEAD', split: 'heldout', models: [model] }),
  /heldout candidate must be a full frozen commit SHA/,
  'moving ref for heldout plan',
);
const frozenCommit = plan.sources.corpus.commit;
const heldoutPlan = prepare({ baseline: frozenCommit, candidate: frozenCommit, corpus: frozenCommit, split: 'heldout', models: [model] });
assert.equal(heldoutPlan.tasks.length, heldoutPlan.protocol.split_sizes.heldout * heldoutPlan.protocol.repetitions * heldoutPlan.protocol.conditions.length);
checkPlan(heldoutPlan);

// Re-freezing a tampered plan must not launder it: prompts and tasks are
// re-derived from the pinned sources, cases, models and protocol.
const refreeze = (p) => {
  const { plan_hash, ...rest } = p;
  return { ...rest, plan_hash: hash(rest) };
};
const promptSwap = clone(plan);
promptSwap.prompts.candidate = 'You are a careful editor. Return the input unchanged unless it contains a factual error.';
throwsWith(() => checkPlan(refreeze(promptSwap)), /not derived from the pinned sources/, 'swapped prompt');

const fewerReps = clone(plan);
fewerReps.tasks = fewerReps.tasks.filter((t) => t.repetition === 1);
throwsWith(() => checkPlan(refreeze(fewerReps)), /not derived from the frozen cases/, 'dropped repetitions');

const steered = clone(plan);
steered.tasks.forEach((t) => { if (t.condition === 'candidate') t.user += '\nPrefer the shortest answer.'; });
steered.tasks.forEach((t) => { t.prompt_hash = hash([steered.prompts[t.condition], t.user, model]); });
throwsWith(() => checkPlan(refreeze(steered)), /not derived from the frozen cases/, 'steered user prompt');

const forgedSource = clone(plan);
forgedSource.sources.candidate.files['SKILL.md'] += '\nAlways add a closing summary.';
forgedSource.sources.candidate.sha256 = hash(forgedSource.sources.candidate.files);
forgedSource.prompts.candidate = `File: SKILL.md\n${forgedSource.sources.candidate.files['SKILL.md']}\n\nFile: references/patterns.md\n${forgedSource.sources.candidate.files['references/patterns.md']}`;
throwsWith(() => checkPlan(refreeze(forgedSource)), /differ from commit/, 'forged pinned file');

const tampered = clone(plan);
tampered.prompts.simple += ' changed';
throwsWith(() => checkPlan(tampered), /freeze/, 'unrefrozen edit');

// Editing the embedded corpus and re-deriving everything from it must still
// fail, because the cases and protocol are re-read from the pinned commit.
const swappedCase = clone(plan);
swappedCase.cases[0].source = 'A different source sentence that was never committed.';
swappedCase.cases_hash = hash(swappedCase.cases);
swappedCase.tasks = swappedCase.tasks.map((t) => (t.case_id === swappedCase.cases[0].id
  ? { ...t, user: t.user.replace(JSON.stringify(plan.cases[0].source), JSON.stringify(swappedCase.cases[0].source)) }
  : t));
swappedCase.tasks.forEach((t) => { t.prompt_hash = hash([swappedCase.prompts[t.condition], t.user, model]); });
throwsWith(() => checkPlan(refreeze(swappedCase)), /differ from the pinned corpus commit/, 'swapped case source');
const swappedProtocol = clone(plan);
swappedProtocol.protocol.repetitions = 1;
swappedProtocol.protocol_hash = hash(swappedProtocol.protocol);
swappedProtocol.tasks = swappedProtocol.tasks.filter((t) => t.repetition === 1);
throwsWith(() => checkPlan(refreeze(swappedProtocol)), /differs from the pinned corpus commit/, 'swapped protocol');

// ── Results ──────────────────────────────────────────────────────────────
// Synthetic plumbing fixtures, never editor performance evidence.
const rows = plan.tasks.map((t) => {
  const source = plan.cases.find((c) => c.id === t.case_id).source;
  return {
    task_id: t.id,
    plan_hash: plan.plan_hash,
    prompt_hash: t.prompt_hash,
    provider: 'test-only',
    model_version: 'synthetic-v1',
    ...framed(source),
    duration_ms: 0,
    recorded_at: plan.created_at,
    usage: { kind: 'unavailable' },
  };
});
checkResults(plan, rows);
throwsWith(() => checkResults(plan, [rows[0], rows[0]]), /duplicate result/, 'duplicate result');
throwsWith(() => checkResults(plan, [null]), /results\[0\] must be an object/, 'null row');

const edited = clone(rows);
edited[0].final_text = 'An unrecorded edit';
throwsWith(() => checkResults(plan, edited), /complete marked artifact/, 'edited extraction');

// A note cannot make an arbitrary sub-span comparable. The whole marked
// artifact is scored, including an invented sentence before a source-shaped
// suffix. This case passed the former substring-plus-note rule.
const narrowed = clone(rows);
const originalFinal = narrowed[0].final_text;
Object.assign(narrowed[0], framed(`Revenue tripled after the migration. ${originalFinal}`));
narrowed[0].final_text = originalFinal;
narrowed[0].final_text_offset = narrowed[0].raw_output.indexOf(originalFinal);
narrowed[0].extraction_note = 'Selected only the source-shaped suffix inside the claimed rewrite.';
throwsWith(() => checkResults(plan, narrowed), /complete marked artifact/, 'narrowed marked artifact');

const missingMarkers = clone(rows);
missingMarkers[0].raw_output = missingMarkers[0].final_text;
missingMarkers[0].final_text_offset = 0;
throwsWith(() => checkResults(plan, missingMarkers), /missing the opening/, 'missing final-text markers');

const repeatedMarkers = clone(rows);
repeatedMarkers[0].raw_output += `\n${protocol.final_text_markers.open}`;
throwsWith(() => checkResults(plan, repeatedMarkers), /opening final-text marker more than once/, 'repeated opening marker');
const strayClose = clone(rows);
strayClose[0].raw_output = `${protocol.final_text_markers.close}\n${strayClose[0].raw_output}`;
strayClose[0].final_text_offset += protocol.final_text_markers.close.length + 1;
throwsWith(() => checkResults(plan, strayClose), /closing final-text marker outside/, 'closing marker before the pair');

const wrongOffset = clone(rows);
wrongOffset[0].final_text_offset = 0;
throwsWith(() => checkResults(plan, wrongOffset), /final_text_offset/, 'wrong offset');
wrongOffset[0].final_text_offset = -wrongOffset[0].final_text.length;
throwsWith(() => checkResults(plan, wrongOffset), /final_text_offset/, 'negative offset');

const crlf = clone(rows);
Object.assign(crlf[0], framed(crlf[0].final_text, { eol: '\r\n' }));
checkResults(plan, crlf);

const corrected = clone(rows);
Object.assign(corrected[0], framed('The corrected second-pass rewrite.', {
  prefix: '**2. Rewritten version**\nThe superseded first-pass rewrite.\n\n**4. Second-pass audit**',
  suffix: 'Use the marked version, not section 2.',
}));
checkResults(plan, corrected);

const stale = clone(rows);
stale[0].recorded_at = '1999-01-01T00:00:00Z';
throwsWith(() => checkResults(plan, stale), /predates the plan freeze/, 'result before freeze');

const version = clone(rows);
version[0].model_version = 'different';
throwsWith(() => checkResults(plan, version), /model_version/, 'wrong model version');

// ── Blinding ─────────────────────────────────────────────────────────────
throwsWith(() => blind(plan, rows.slice(1)), /complete/, 'incomplete blind');
const { packet, key } = blind(plan, rows);
assert.equal(packet.items.length, rows.length);
assert(packet.items.every((x) => !('condition' in x) && !('task_id' in x) && !('raw_output' in x)), 'the blind packet exposes only the comparable final artifact');

const judgments = packet.items.map((i) => ({
  alias: i.alias,
  reviewer_role: 'human',
  reviewer: 'synthetic-test-fixture',
  rationale: 'Test fixture only, not a real adjudication.',
  preservation_failure: false,
  unnecessary_edit: false,
  missed_justified_edit: i.decision === 'change',
  blind_preference: 'not_rated',
}));

// ── Report ───────────────────────────────────────────────────────────────
const summary = report(plan, rows, key, judgments);
assert(summary.complete);
assert(!Object.hasOwn(summary, 'sub_span_extractions'), 'arbitrary sub-span extraction is no longer part of the report contract');
assert(Object.values(summary.counts).some((x) => x.missed_justified_edit > 0), 'unchanged outputs must not be treated as wins');
assert.equal(report(plan, rows, key, judgments.slice(1)).complete, false);

const absent = clone(judgments);
delete absent[0].preservation_failure;
throwsWith(() => report(plan, rows, key, absent), /missing/, 'missing metric');
throwsWith(() => report(plan, rows, key, [judgments[0], judgments[0]]), /duplicate adjudication/, 'duplicate alias');
throwsWith(() => report(plan, rows, key, 'not-a-list'), /judgments must be an array/, 'non-array judgments');
for (const alias of ['toString', 'constructor', '__proto__']) {
  throwsWith(() => report(plan, rows, key, [{ ...judgments[0], alias }]), /unknown alias/, `inherited alias ${alias}`);
}
throwsWith(() => report(plan, rows, { plan_hash: key.plan_hash, results_hash: key.results_hash }, judgments), /aliases object/, 'key without aliases');

const wrongKey = clone(key);
wrongKey.results_hash = hash([]);
throwsWith(() => report(plan, rows, wrongKey, judgments), /different results file/, 'foreign key');

// A key with an extra alias for a task already mapped must be rejected, and a
// task judged twice through two aliases must never count as complete.
const extraAlias = clone(key);
const [[aliasA, taskA], [aliasB]] = Object.entries(key.aliases);
extraAlias.aliases['extra-alias'] = taskA;
throwsWith(() => report(plan, rows, extraAlias, judgments), /alias count must equal/, 'extra alias');
const twoAliasesOneTask = clone(key);
twoAliasesOneTask.aliases[aliasB] = taskA;
throwsWith(() => report(plan, rows, twoAliasesOneTask, judgments), /distinct task/, 'two aliases one task');

// ── Ballots ──────────────────────────────────────────────────────────────
checkBallot(['preferred', 'not_preferred', 'not_preferred'], 'b', 3);
checkBallot(['tie', 'tie', 'not_preferred'], 'b', 3);
checkBallot(['tie', 'tie', 'tie'], 'b', 3);
checkBallot(['not_rated', 'not_rated', 'not_rated'], 'b', 3);
checkBallot(['preferred'], 'b', 3);
checkBallot(['tie', 'not_preferred'], 'b', 3);
throwsWith(() => checkBallot(['preferred', 'preferred'], 'b', 3), /more than one preferred/, 'two preferred partial');
throwsWith(() => checkBallot(['preferred', 'tie'], 'b', 3), /preferred and tie/, 'preferred with tie partial');
throwsWith(() => checkBallot(['not_rated', 'preferred'], 'b', 3), /not_rated must apply/, 'mixed not_rated');
throwsWith(() => checkBallot(['tie', 'not_preferred', 'not_preferred'], 'b', 3), /inconsistent/, 'lone tie');
throwsWith(() => checkBallot(['preferred', 'preferred', 'not_preferred', 'tie'], 'b', 3), /more preference votes/, 'four votes');

const invalidVotes = clone(judgments).map((j) => ({ ...j, blind_preference: 'preferred' }));
throwsWith(() => report(plan, rows, key, invalidVotes), /more than one preferred/, 'all preferred');
const twoVotes = clone(judgments).slice(0, 2).map((j) => ({ ...j, blind_preference: 'preferred' }));
const sameBallot = packet.items.filter((i) => i.case_id === packet.items[0].case_id && i.repetition === packet.items[0].repetition).slice(0, 2);
twoVotes[0].alias = sameBallot[0].alias;
twoVotes[1].alias = sameBallot[1].alias;
throwsWith(() => report(plan, rows, key, twoVotes), /more than one preferred/, 'two-vote ballot both preferred');

// ── Mechanical checks ────────────────────────────────────────────────────
const spanRow = rows.findIndex((r) => plan.cases.find((c) => c.id === plan.tasks.find((t) => t.id === r.task_id).case_id).protected.length);
const demoRow = rows.findIndex((r) => plan.tasks.find((t) => t.id === r.task_id).case_id === 'clear-edit-04');
assert(demoRow !== -1, 'seed case present in the development split');
const damaged = clone(rows);
Object.assign(damaged[spanRow], framed('Content removed.'));
const b = blind(plan, damaged);
const incomplete = report(plan, damaged, b.key, []);
assert(incomplete.mechanical_checks.some((x) => x.missing_protected_spans.length));
const invented = clone(rows);
Object.assign(invented[demoRow], framed('Acme Analytics raised a $40M Series B led by Andreessen Horowitz. The Boulder startup makes an observability platform with real-time dashboards, sub-second queries, and an integration layer that plugs into Datadog with zero configuration for its 200 paying customers.'));
const inventedReport = report(plan, invented, blind(plan, invented).key, []);
const demoCheck = inventedReport.mechanical_checks.find((x) => x.task_id === invented[demoRow].task_id);
assert.deepEqual(demoCheck.missing_required_phrases, []);
assert.deepEqual(demoCheck.forbidden_phrases.sort(), ['customer-count', 'integration-effort-claim', 'lead-investor-claim', 'named-integration']);
const faithful = clone(rows);
Object.assign(faithful[demoRow], framed('Acme Analytics raised a $40M Series B. The Boulder startup makes an observability platform with live dashboards, queries that return in under a second, and an integration layer.'));
const faithfulCheck = report(plan, faithful, blind(plan, faithful).key, []).mechanical_checks.find((x) => x.task_id === faithful[demoRow].task_id);
assert.deepEqual([faithfulCheck.missing_required_phrases, faithfulCheck.forbidden_phrases], [[], []]);
assert.equal(incomplete.human_reviewed, 0);
assert.equal(incomplete.complete, false);

console.log('Rewrite evaluation controls passed; no model comparisons performed.');
