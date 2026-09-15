#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const AIDetector = require('../detector/patterns.js');
const { legacyPrepareUnits } = require('./fp-measure.js');
const {
  MIN_WORDS,
  MAX_WORDS,
  prepareUnits,
  normalizeUnit,
  splitUnits,
  unitsForText,
} = require('./fp-preprocess.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  process.stdout.write(`  ✓ ${name}\n`);
}

const words = (count, prefix = 'Word') => Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(' ');
const tokens = (text) => text.match(/\S+/gu) || [];

test('exports the agreed limits and wrapper behavior', () => {
  assert.equal(MIN_WORDS, 50);
  assert.equal(MAX_WORDS, 400);
  const text = words(50);
  assert.deepEqual(splitUnits(text), [text]);
  assert.deepEqual(unitsForText(text), [text]);
  assert.deepEqual(unitsForText(text, 'document'), [text]);
  assert.equal(normalizeUnit('One hard\nwrapped line.'), 'One hard wrapped line.');
  assert.throws(() => prepareUnits(text, 'sentence'), /unknown unit mode/);
});

test('document mode preserves token order and bypasses every paragraph filter', () => {
  for (const text of ['', 'tiny', words(401), '    const value = 1;']) {
    const result = prepareUnits(text, 'document');
    assert.equal(result.decisions.length, 1);
    assert.equal(result.decisions[0].status, 'selected');
    assert.equal(result.decisions[0].reason, null);
    assert.deepEqual(tokens(result.normalizedText), tokens(text));
    assert.deepEqual(result.decisions[0].spans, [{ start: 0, end: text.length }]);
  }
});

test('generated whitespace matrix keeps duplicate and Unicode tokens in order', () => {
  const samples = [
    ['same', 'same', 'naïve', '東京', '🙂', 'same'],
    ['α', 'β', 'α', 'e\u0301', 'é', 'β'],
  ];
  const separators = [' ', '\n', '\n\n', '\r\n', '\r', '\t', '  \n'];
  for (const sample of samples) {
    for (let mask = 0; mask < 128; mask++) {
      let input = sample[0];
      for (let i = 1; i < sample.length; i++) input += separators[(mask + i * 3) % separators.length] + sample[i];
      const output = prepareUnits(input, 'document').normalizedText;
      assert.deepEqual(tokens(output), tokens(input), `mask ${mask}: ${JSON.stringify(input)}`);
      assert.equal(/\r/.test(output), false);
    }
  }
});

test('colon heading boundary matrix handles case, count, spacing, and line endings', () => {
  const separators = ['\n', '\n\n', '\r\n', '\r\r'];
  for (const separator of separators) {
    for (const prefix of ['Word', 'word']) {
      for (const count of [399, 400, 401]) {
        const input = `Context:${separator}${words(count, prefix)}`;
        const doc = prepareUnits(input, 'document');
        assert.equal(doc.decisions.length, 1);
        assert.equal(doc.decisions[0].status, 'selected');
        assert.deepEqual(tokens(doc.normalizedText), tokens(input));

        const para = prepareUnits(input, 'paragraph');
        const selected = para.decisions.filter((decision) => decision.status === 'selected');
        const lowercaseImmediate = (separator === '\n' || separator === '\r\n') && prefix === 'word';
        if (lowercaseImmediate) {
          assert.equal(para.decisions.some((decision) => decision.headingKind === 'colon-inferred'), false);
          assert.equal(selected.length, count === 399 ? 1 : 0);
        } else if (count === 399) {
          assert.equal(selected.length, 1);
          assert.equal(selected[0].inputWords, 400);
          assert.equal(selected[0].headingAttached, true);
          assert.equal(selected[0].headingKind, 'colon-inferred');
        } else if (count === 400) {
          assert.equal(selected.length, 1);
          assert.equal(selected[0].inputWords, 400);
          assert.equal(selected[0].headingAttached, false);
        } else {
          assert.equal(selected.length, 0);
        }
      }
    }
  }
});

test('heading attachment spans use original CRLF offsets and never duplicate a body', () => {
  const body399 = words(399);
  const attachedInput = `Context:\r\n${body399}`;
  const attached = prepareUnits(attachedInput).decisions;
  assert.equal(attached.length, 1);
  assert.deepEqual(attached[0].spans, [
    { start: 0, end: 'Context:'.length },
    { start: 'Context:\r\n'.length, end: attachedInput.length },
  ]);
  assert.equal(attached[0].text, `Context:\n${body399}`);

  const body400 = words(400);
  const detachedInput = `Context:\r\n${body400}`;
  const detached = prepareUnits(detachedInput).decisions;
  assert.equal(detached.length, 2);
  assert.equal(detached[0].reason, 'heading-would-exceed-maximum');
  assert.equal(detached[1].status, 'selected');
  assert.deepEqual(detached[1].spans, [{ start: 'Context:\r\n'.length, end: detachedInput.length }]);
  assert.equal(detached.filter((decision) => decision.spans.some((span) => span.start === 'Context:\r\n'.length)).length, 1);
});

test('explicit ATX headings attach regardless of lowercase continuation', () => {
  for (const indent of ['', '   ']) {
    const input = `${indent}## Context\nlowercase ${words(397, 'body')}`;
    const result = prepareUnits(input).decisions;
    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'selected');
    assert.equal(result[0].headingKind, 'atx');
    assert.equal(result[0].headingAttached, true);
    assert.match(result[0].text, /## Context\nlowercase/);
  }
  assert.equal(prepareUnits('    ## code\n' + words(50)).decisions.some((d) => d.headingKind === 'atx'), false);
});

test('two and three consecutive headings leave only the nearest attached', () => {
  for (const count of [2, 3]) {
    const headings = Array.from({ length: count }, (_, i) => `## Heading ${i + 1}`);
    const input = `${headings.join('\n')}\n${words(50)}`;
    const decisions = prepareUnits(input).decisions;
    assert.equal(decisions.length, count);
    for (let i = 0; i < count - 1; i++) {
      assert.equal(decisions[i].reason, 'unattached-heading');
      assert.equal(decisions[i].headingAttached, false);
    }
    assert.equal(decisions[count - 1].status, 'selected');
    assert.equal(decisions[count - 1].headingAttached, true);
    assert.match(decisions[count - 1].text, new RegExp(`Heading ${count}\\nWord0`));
  }

  const colonInput = `Alpha:\nBeta:\nGamma:\n${words(50)}`;
  const colonDecisions = prepareUnits(colonInput).decisions;
  assert.equal(colonDecisions.length, 3);
  assert.deepEqual(colonDecisions.map((decision) => decision.headingKind), [
    'colon-inferred', 'colon-inferred', 'colon-inferred',
  ]);
  assert.deepEqual(colonDecisions.map((decision) => decision.headingAttached), [false, false, true]);

  const longHeading = `## ${words(49, 'heading')}`;
  const consecutiveLong = prepareUnits(`${longHeading}\n${longHeading}\n${words(10, 'body')}`).decisions;
  assert.equal(consecutiveLong.length, 2);
  assert.equal(consecutiveLong[0].status, 'selected');
  assert.equal(consecutiveLong[0].inputWords, 50);
  assert.equal(consecutiveLong[0].headingAttached, false);
  assert.equal(consecutiveLong[1].status, 'selected');
  assert.equal(consecutiveLong[1].headingAttached, true);
});

test('eligible standalone and detached heading blocks use normal word eligibility', () => {
  const atx = `## ${words(49)}`;
  const standaloneAtx = prepareUnits(atx).decisions;
  assert.equal(standaloneAtx.length, 1);
  assert.equal(standaloneAtx[0].inputWords, 50);
  assert.equal(standaloneAtx[0].status, 'selected');
  assert.equal(standaloneAtx[0].reason, null);
  assert.equal(standaloneAtx[0].headingKind, 'atx');

  const setext = `${words(49)}\n=====`;
  const standaloneSetext = prepareUnits(setext).decisions;
  assert.equal(standaloneSetext.length, 1);
  assert.equal(standaloneSetext[0].inputWords, 50);
  assert.equal(standaloneSetext[0].status, 'selected');
  assert.equal(standaloneSetext[0].headingKind, 'setext');

  const detached = prepareUnits(`${atx}\n${words(400, 'body')}`).decisions;
  assert.equal(detached.length, 2);
  assert.deepEqual(detached.map((decision) => decision.status), ['selected', 'selected']);
  assert.deepEqual(detached.map((decision) => decision.inputWords), [50, 400]);
  assert.equal(detached[0].headingAttached, false);
  assert.equal(detached[1].headingAttached, false);
});

test('colon inference is limited to block starts and labels its diagnostics', () => {
  const ordinary = `He said the following:\nNothing at all, and the room stayed silent. ${words(410)}`;
  const result = prepareUnits(ordinary);
  assert.ok(result.normalizedText.includes('He said the following:\nNothing at all'));
  assert.equal(result.decisions[0].headingKind, 'colon-inferred');
  assert.equal(result.decisions[0].reason, 'heading-would-exceed-maximum');
  assert.ok(result.decisions.some((decision) => decision.text.startsWith('Nothing at all')));

  const midParagraph = `This sentence begins here\nand continues with a label:\nThen finishes with ${words(50)}`;
  const mid = prepareUnits(midParagraph);
  assert.equal(mid.decisions.some((decision) => decision.headingKind === 'colon-inferred'), false);
  assert.match(mid.normalizedText, /begins here and continues with a label: Then finishes/);

  for (const source of ['- List item:', '> Quoted label:', '    config:']) {
    assert.equal(prepareUnits(`${source}\n${words(50)}`).decisions.some((d) => d.headingKind === 'colon-inferred'), false);
  }
});

test('only ordinary hard-wrapped prose is joined', () => {
  const input = [
    'Ordinary prose is hard',
    'wrapped across source lines.',
    'A Markdown break stays here.  ',
    'This remains on a new line.',
    'A backslash break stays too.\\',
    'This also remains on a new line.',
    '> quoted text keeps',
    '> every source line',
    '- list text keeps',
    '  its lazy continuation',
    '    indented code keeps spacing',
  ].join('\r\n');
  const output = normalizeUnit(input);
  assert.ok(output.startsWith('Ordinary prose is hard wrapped across source lines.'));
  assert.ok(output.includes('A Markdown break stays here.  \nThis remains'));
  assert.ok(output.includes('A backslash break stays too.\\\nThis also'));
  assert.ok(output.includes('> quoted text keeps\n> every source line'));
  assert.ok(output.includes('- list text keeps\n  its lazy continuation'));
  assert.ok(output.includes('    indented code keeps spacing'));
  assert.equal(output.includes('\r'), false);
});

test('mid-paragraph ordinals do not start a list run', () => {
  const historical = [
    'The decisive year was',
    '1859. The publication of that work changed the temper of the debate,',
    `and no one who has read it can afford to pass over the evidence. ${words(35, 'tail')}`,
  ].join('\n');
  const decision = prepareUnits(historical).decisions[0];
  assert.deepEqual(decision.kinds, ['prose']);
  assert.equal(decision.text.includes('\n'), false);
  assert.match(decision.text, /year was 1859\. The publication/);

  const indentedContinuation = [
    'The decisive year was',
    '    discussed by the committee in',
    `1859. The publication changed the debate. ${words(40, 'tail')}`,
  ].join('\n');
  const indented = prepareUnits(indentedContinuation).decisions[0];
  assert.deepEqual(indented.kinds, ['prose']);
  assert.equal(indented.text.includes('\n'), false);

  for (const input of [
    `Prose opens here\n1. First item ${words(48)}`,
    `Prose opens here\n01. First item ${words(48)}`,
    `Prose opens here\n- Bullet item ${words(48)}`,
    `Prose opens here\n\n1859. Ordered item ${words(48)}`,
    `## Context\n2. Ordered item ${words(48)}`,
  ]) {
    assert.ok(prepareUnits(input).decisions.some((item) => item.kinds.includes('list')), input);
  }

  const afterCode = prepareUnits(`    code\n2. Second item ${words(50)}`).decisions;
  assert.ok(afterCode.some((item) => item.kinds.includes('indented-code')));
  assert.ok(afterCode.some((item) => item.kinds.includes('list')));

  for (const marker of ['2. Ordered item', '1859. Historical record']) {
    const afterColon = prepareUnits(`Context:\n${marker} ${words(48, 'tail')}`).decisions;
    assert.equal(afterColon.length, 1);
    assert.deepEqual(afterColon[0].kinds, ['colon-inferred', 'prose']);
    assert.equal(afterColon[0].headingAttached, true);
    assert.equal(afterColon[0].kinds.includes('list'), false);
  }
});

test('mixed prose and five short bullets remain one eligible source body', () => {
  const intro = 'The report contains a list of the available components for this release. Each component has a corresponding entry in the inventory and a named owner on the review team. The owner checks the entry against the published release manifest before every scheduled deployment review.';
  const bullets = ['Cloud platform', 'API gateway', 'Data pipeline', 'Event stream', 'Message queue'];
  const input = `${intro}\n${bullets.map((item) => `- ${item}`).join('\n')}`;
  assert.ok(tokens(input).length >= 50);
  const result = prepareUnits(input).decisions;
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'selected');
  assert.ok(result[0].kinds.includes('prose'));
  assert.ok(result[0].kinds.includes('list'));
  for (const bullet of bullets) assert.ok(result[0].text.includes(`- ${bullet}`));

  const analyzed = AIDetector.analyzeText(result[0].text);
  assert.ok(analyzed.issues.some((issue) => issue.type === 'bullet-np-list'));

  const withBlank = `${intro}\n\n${bullets.map((item) => `- ${item}`).join('\n')}`;
  const blankResult = prepareUnits(withBlank).decisions;
  assert.equal(blankResult.length, 1);
  assert.equal(blankResult[0].status, 'selected');
  assert.ok(blankResult[0].text.includes(`${intro}\n\n- Cloud platform`));

  const twoWordBullets = ['Cloud platform', 'API gateway', 'Data pipeline', 'Event stream', 'Message queue']
    .map((item) => `- ${item}`)
    .join('\n');
  for (const proseWords of [386, 390, 399]) {
    const over = prepareUnits(`${words(proseWords)}\n\n${twoWordBullets}`).decisions;
    assert.equal(over[0].status, 'selected');
    assert.equal(over[0].inputWords, proseWords);
    assert.equal(over[0].text, words(proseWords));
    assert.equal(over[1].reason, 'below-min');
    assert.equal(Object.hasOwn(over[0], 'mergedContinuation'), false);
  }
  const exact = prepareUnits(`${words(385)}\n\n${twoWordBullets}`).decisions;
  assert.equal(exact.length, 1);
  assert.equal(exact[0].status, 'selected');
  assert.equal(exact[0].inputWords, 400);
  assert.equal(exact[0].mergedContinuation, true);

  const unicodeBullets = ['Cloud platform', 'API gateway', 'Data pipeline', 'Event stream', 'Message queue']
    .map((item) => `• ${item}`)
    .join('\n');
  const unicodeInput = `${words(40)}\n${unicodeBullets}`;
  assert.equal(tokens(unicodeInput).length, 55);
  const rawUnicodeTypes = AIDetector.analyzeText(unicodeInput).issues.map((issue) => issue.type);
  const unicodePrepared = prepareUnits(unicodeInput).decisions;
  assert.equal(unicodePrepared.length, 1);
  assert.equal(unicodePrepared[0].status, 'selected');
  assert.deepEqual(unicodePrepared[0].kinds, ['prose', 'list']);
  const preparedUnicodeTypes = AIDetector.analyzeText(unicodePrepared[0].text).issues.map((issue) => issue.type);
  assert.ok(rawUnicodeTypes.includes('bullet-np-list'));
  assert.ok(preparedUnicodeTypes.includes('bullet-np-list'));

  const indentedBullets = [
    '    * Cloud platform',
    '\t- API gateway',
    '      • Data pipeline',
    '\t+ Event stream',
    '    - Message queue',
  ].join('\n');
  const indentedInput = `${words(40)}\n${indentedBullets}`;
  const rawIndentedTypes = AIDetector.analyzeText(indentedInput).issues.map((issue) => issue.type);
  const indentedPrepared = prepareUnits(indentedInput).decisions;
  assert.equal(indentedPrepared.length, 1);
  assert.equal(indentedPrepared[0].status, 'selected');
  assert.ok(indentedPrepared[0].text.includes('\n    * Cloud platform\n\t- API gateway'));
  const preparedIndentedTypes = AIDetector.analyzeText(indentedPrepared[0].text).issues.map((issue) => issue.type);
  assert.ok(rawIndentedTypes.includes('bullet-np-list'));
  assert.ok(preparedIndentedTypes.includes('bullet-np-list'));
});

test('detector deltas are pinned against the frozen legacy preparation', () => {
  const detect = (prepare, text) => prepare(text).decisions
    .filter((decision) => decision.status === 'selected')
    .map((decision) => AIDetector.analyzeText(decision.text, { contextMode: 'general', sourceMode: 'plain' }));
  const types = (results) => results.flatMap((result) => result.issues.map((issue) => issue.type));

  const quote = [
    '> The record was genuinely useful.',
    '> At dawn, the second group carefully recorded every ordinary observation from the northern room before returning home.',
    '> The smaller result was truly useful.',
    '> Nothing changed during this trial, although several reviewers stayed late to compare individual pages against older copies in storage and record their doubts.',
    '> Everyone left.',
  ].join('\n');
  const legacyQuote = detect(legacyPrepareUnits, quote);
  const currentQuote = detect(prepareUnits, quote);
  assert.deepEqual(legacyQuote.map((result) => result.score), [4]);
  assert.equal(types(legacyQuote).length, 2);
  assert.deepEqual(currentQuote.map((result) => result.score), [0]);
  assert.deepEqual(types(currentQuote), []);

  const bullets = `${words(45, 'intro')}\n${['Cloud platform', 'API gateway', 'Data pipeline', 'Event stream', 'Message queue'].map((item) => `- ${item}`).join('\n')}`;
  assert.deepEqual(types(detect(legacyPrepareUnits, bullets)), []);
  assert.deepEqual(types(detect(prepareUnits, bullets)), ['bullet-np-list']);

  const setext = `Benefits And Strategic Considerations\n=====\n${words(50, 'body')}`;
  assert.deepEqual(types(detect(legacyPrepareUnits, setext)), []);
  assert.deepEqual(types(detect(prepareUnits, setext)), ['title-case-header']);

  const fence = `\`\`\`\n- Cloud platform\n- API gateway\n- Data pipeline\n- Event stream\n- Message queue\n# Benefits And Strategic Considerations\n\`\`\`\n${words(50, 'body')}`;
  assert.deepEqual(types(detect(legacyPrepareUnits, fence)), []);
  assert.deepEqual(types(detect(prepareUnits, fence)), []);
});

test('heading markers remain source tokens at selection boundaries', () => {
  const atFloor = prepareUnits(`## ${words(49, 'heading')}`).decisions[0];
  assert.equal(atFloor.inputWords, 50);
  assert.equal(atFloor.status, 'selected');

  const over = prepareUnits(`#### A B\n${words(398, 'body')}`).decisions;
  assert.equal(over[0].headingAttached, false);
  assert.equal(over[0].reason, 'heading-would-exceed-maximum');
  assert.equal(over[1].inputWords, 398);

  const atCeiling = prepareUnits(`## Context\n${words(398, 'body')}`).decisions[0];
  assert.equal(atCeiling.inputWords, 400);
  assert.equal(atCeiling.headingAttached, true);
});

test('blank-separated list and quote continuations retain their layout', () => {
  const list = `- First item has context\n\n  continued after a blank\n\n- Second item has context\n${words(45)}`;
  const listDecision = prepareUnits(list).decisions[0];
  assert.equal(listDecision.status, 'selected');
  assert.ok(listDecision.kinds.includes('list'));
  assert.ok(listDecision.text.includes('- First item has context\n\n  continued after a blank\n\n- Second item'));

  const longFirstItem = `- ${words(398)}`;
  const shortList = ['- Cloud platform', '- API gateway', '- Data pipeline', '- Event stream', '- Message queue'].join('\n');
  const boundedList = prepareUnits(`${longFirstItem}\n\n${shortList}`).decisions;
  assert.equal(boundedList.length, 2);
  assert.equal(boundedList[0].status, 'selected');
  assert.equal(boundedList[0].inputWords, 399);
  assert.equal(boundedList[1].reason, 'below-min');

  const quote = Array.from({ length: 5 }, () => '> What surprised me most was the detailed report on migration results across three production hosts.').join('\n');
  const quoteDecision = prepareUnits(quote).decisions[0];
  assert.equal(quoteDecision.status, 'selected');
  assert.equal(quoteDecision.text, quote);
  const analyzedQuote = AIDetector.analyzeText(quoteDecision.text);
  assert.equal(analyzedQuote.tooShort, true);
  assert.equal(analyzedQuote.stats.wordCount, 0, 'the detector still observes and masks the quote structure');
});

test('quotes and thematic breaks terminate list classification without losing body structure', () => {
  const listThenQuote = [
    `- Opening item ${words(18, 'item')}`,
    `> Quoted one ${words(14, 'quote')}`,
    `> Quoted two ${words(14, 'more')}`,
  ].join('\n');
  const quoted = prepareUnits(listThenQuote).decisions;
  assert.equal(quoted.length, 1);
  assert.equal(quoted[0].status, 'selected');
  assert.deepEqual(quoted[0].kinds, ['list', 'blockquote']);
  assert.equal(quoted[0].text, listThenQuote);

  const indentedQuote = `${words(20)}\n    > Quoted one ${words(14, 'quote')}\n\t> Quoted two ${words(14, 'more')}`;
  const preparedIndentedQuote = prepareUnits(indentedQuote).decisions;
  assert.equal(preparedIndentedQuote.length, 1);
  assert.equal(preparedIndentedQuote[0].status, 'selected');
  assert.deepEqual(preparedIndentedQuote[0].kinds, ['prose', 'blockquote']);
  assert.equal(preparedIndentedQuote[0].text, indentedQuote);
  assert.equal(
    AIDetector.analyzeText(preparedIndentedQuote[0].text).stats.wordCount,
    AIDetector.analyzeText(indentedQuote).stats.wordCount,
  );

  const listThenRule = `- Opening item ${words(47)}\n---\nClosing prose stays visible.`;
  const ruled = prepareUnits(listThenRule).decisions;
  assert.equal(ruled.length, 1);
  assert.equal(ruled[0].status, 'selected');
  assert.deepEqual(ruled[0].kinds, ['list', 'thematic-break', 'prose']);
  assert.ok(ruled[0].text.includes('\n---\nClosing prose stays visible.'));
});

test('setext headings win over thematic breaks while standalone rules remain structural', () => {
  const input = `Benefits And Strategic Considerations\n=====\n\n${words(50)}`;
  const result = prepareUnits(input).decisions;
  assert.equal(result.length, 1);
  assert.equal(result[0].headingKind, 'setext');
  assert.equal(result[0].headingAttached, true);
  assert.ok(result[0].text.startsWith('Benefits And Strategic Considerations\n====='));

  const thematic = prepareUnits(`---\n${words(50)}`).decisions;
  assert.equal(thematic.some((decision) => decision.headingKind === 'setext'), false);
  assert.ok(thematic[0].kinds.includes('thematic-break'));

  const wrapped = prepareUnits(`First wrapped line\nSecond wrapped line\n---\n\n${words(50)}`).decisions;
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].headingKind, 'setext');
  assert.equal(wrapped[0].headingAttached, true);
  assert.ok(wrapped[0].text.startsWith('First wrapped line\nSecond wrapped line\n---'));

  const adjacent = prepareUnits(`First Heading\n===\nSecond Heading\n---\n\n${words(50)}`).decisions;
  assert.equal(adjacent.length, 2);
  assert.equal(adjacent[0].headingKind, 'setext');
  assert.equal(adjacent[0].headingAttached, false);
  assert.ok(adjacent[0].text.startsWith('First Heading\n==='));
  assert.equal(adjacent[1].headingKind, 'setext');
  assert.equal(adjacent[1].headingAttached, true);
  assert.ok(adjacent[1].text.startsWith('Second Heading\n---'));

  for (const title of [
    'Heading start\n    indented continuation',
    'Heading start\n    indented continuation\nHeading end',
  ]) {
    const continued = prepareUnits(`${title}\n---\n\n${words(50)}`).decisions;
    assert.equal(continued.length, 1);
    assert.equal(continued[0].headingKind, 'setext');
    assert.equal(continued[0].headingAttached, true);
    assert.ok(continued[0].text.startsWith(`${title}\n---`));
  }

  const afterCode = prepareUnits(`    code\nHeading after code\n---\n\n${words(50)}`).decisions;
  assert.equal(afterCode.length, 2);
  assert.deepEqual(afterCode[0].kinds, ['indented-code']);
  assert.ok(afterCode[1].text.startsWith('Heading after code\n---'));

  const yearHeading = prepareUnits(`Heading start\n2024. was busy\n---\n\n${words(50)}`).decisions;
  assert.equal(yearHeading.length, 1);
  assert.equal(yearHeading[0].headingKind, 'setext');
  assert.ok(yearHeading[0].text.startsWith('Heading start\n2024. was busy\n---'));

  for (const container of ['> quoted text', '- list item', '1. ordered item']) {
    const lazy = prepareUnits(`${container}\nlazy continuation\n---\n${words(50)}`).decisions;
    assert.equal(lazy.some((decision) => decision.headingKind === 'setext'), false, container);
    assert.ok(lazy.some((decision) => decision.kinds.includes('thematic-break')), container);
  }

  for (const closedQuote of ['>', '> # Heading']) {
    const decisions = prepareUnits(`Intro text\n${closedQuote}\nText\n---\n\n${words(50)}`).decisions;
    const heading = decisions.find((decision) => decision.headingKind === 'setext');
    assert.ok(heading, closedQuote);
    assert.ok(heading.text.startsWith('Text\n---'), closedQuote);
  }

  for (const indentation of ['  ', '    ']) {
    const loose = prepareUnits(`- item\n\n${indentation}continued paragraph\nText\n---\n${words(50)}`).decisions;
    assert.equal(loose.some((decision) => decision.headingKind === 'setext'), false, `${indentation.length} spaces`);
    assert.ok(loose.some((decision) => decision.kinds.includes('thematic-break')), `${indentation.length} spaces`);
  }

  const blockStartOrdinal = prepareUnits(`Intro\n\n2024. item\nText\n---\n${words(50)}`).decisions;
  assert.equal(blockStartOrdinal.some((decision) => decision.headingKind === 'setext'), false);
  assert.ok(blockStartOrdinal.some((decision) => decision.kinds.includes('thematic-break')));

  const quotedList = prepareUnits(`> - item\nlazy continuation\n---\n${words(50)}`).decisions;
  assert.equal(quotedList.some((decision) => decision.headingKind === 'setext'), false);
  assert.ok(quotedList.some((decision) => decision.kinds.includes('thematic-break')));

  const nestedQuote = prepareUnits(`> > nested quote text\nlazy continuation\n---\n${words(50)}`).decisions;
  assert.equal(nestedQuote.some((decision) => decision.headingKind === 'setext'), false);
  assert.ok(nestedQuote.some((decision) => decision.kinds.includes('thematic-break')));

  const multiParagraphList = prepareUnits(`- item\n\n  first continuation\n\n  second continuation\n  ---\n${words(50)}`).decisions;
  assert.equal(multiParagraphList.some((decision) => decision.headingKind === 'setext'), false);
  assert.ok(multiParagraphList.some((decision) => decision.kinds.includes('thematic-break')));
});

test('fences use same-marker valid closers and stay atomic across blank lines', () => {
  const ticks = '````';
  const input = [
    ticks + 'js',
    words(25, 'code'),
    '',
    '~~~',
    '```',
    '```` trailing text',
    words(25, 'more'),
    ticks,
  ].join('\r\n');
  const result = prepareUnits(input);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].status, 'selected');
  assert.deepEqual(result.decisions[0].kinds, ['fenced-code']);
  assert.ok(result.decisions[0].text.includes('\n\n~~~\n```\n```` trailing text\n'));
  assert.deepEqual(tokens(result.decisions[0].text), tokens(input));

  const unclosed = `~~~\n${words(25)}\n\n${words(25, 'tail')}`;
  const unclosedResult = prepareUnits(unclosed).decisions;
  assert.equal(unclosedResult.length, 1);
  assert.deepEqual(unclosedResult[0].kinds, ['fenced-code']);
  assert.ok(unclosedResult[0].text.endsWith('tail24'));

  const inlineTicks = prepareUnits(`\`\`\`x\`\`\` inline\n${words(50)}`).decisions;
  assert.equal(inlineTicks.length, 1);
  assert.deepEqual(inlineTicks[0].kinds, ['prose']);
  assert.ok(inlineTicks[0].text.startsWith('```x``` inline '));

  const tildeInfo = prepareUnits(`~~~x\`y\n${words(50)}\n~~~`).decisions;
  assert.deepEqual(tildeInfo[0].kinds, ['fenced-code']);

  const oversized = `~~~\n${words(210)}\n\n${words(210, 'tail')}\n~~~`;
  const oversizedResult = prepareUnits(oversized).decisions;
  assert.equal(oversizedResult.length, 1);
  assert.equal(oversizedResult[0].reason, 'above-max');
  assert.deepEqual(oversizedResult[0].kinds, ['fenced-code']);

  const tabIndented = [
    '\t```md',
    '## Benefits And Strategic Considerations',
    words(50, 'code'),
    '',
    '- Cloud platform',
    '- API gateway',
    '- Data pipeline',
    '- Event stream',
    '- Message queue',
    '\t```',
  ].join('\n');
  const tabResult = prepareUnits(tabIndented).decisions;
  assert.equal(tabResult.length, 1);
  assert.equal(tabResult[0].status, 'selected');
  assert.deepEqual(tabResult[0].kinds, ['fenced-code']);
  assert.equal(tabResult[0].text, tabIndented);
  const tabTypes = AIDetector.analyzeText(tabResult[0].text).issues.map((issue) => issue.type);
  assert.equal(tabTypes.includes('bullet-np-list'), false);
  assert.equal(tabTypes.includes('title-case-header'), false);
});

test('generated mixed documents assign every structural source span and sentinel exactly once', () => {
  function uniqueSpan(source, fragment) {
    const start = source.indexOf(fragment);
    assert.notEqual(start, -1, `missing fixture fragment: ${fragment.slice(0, 30)}`);
    assert.equal(source.lastIndexOf(fragment), start, `fixture fragment must be unique: ${fragment.slice(0, 30)}`);
    return { start, end: start + fragment.length };
  }

  for (const newline of ['\n', '\r\n', '\r']) {
    const boundaryHeading = 'Boundary399:';
    const boundaryBody = `BODY399_START ${words(397, 'boundary')} BODY399_END`;
    const eligibleHeading = `## HEADING50_START ${words(47, 'heading')} HEADING50_END`;
    const body400 = `BODY400_START ${words(398, 'detached')} BODY400_END`;
    const mixedBody = [
      `MIXED_START ${words(39, 'mixed')}`,
      '- Cloud platform',
      '- API gateway',
      '- Data pipeline',
      '- Event stream',
      '- Message queue',
      `> Quoted observation ${words(8, 'quoted')}`,
      `> MIXED_END ${words(8, 'ending')}`,
    ].join(newline);
    const fence = [
      '\t```md',
      'FENCE_START',
      '## Benefits And Strategic Considerations',
      words(50, 'fenced'),
      '',
      '- Cloud platform',
      '- API gateway',
      '- Data pipeline',
      '- Event stream',
      '- Message queue',
      'FENCE_END',
      '\t```',
    ].join(newline);
    const source = [
      `${boundaryHeading}${newline}${boundaryBody}`,
      `${eligibleHeading}${newline}${body400}`,
      mixedBody,
      fence,
    ].join(newline + newline);

    const decisions = prepareUnits(source).decisions;
    assert.equal(decisions.length, 5);
    assert.deepEqual(decisions.map((decision) => decision.status), Array(5).fill('selected'));
    assert.deepEqual(decisions.map((decision) => decision.inputWords), [400, 50, 400, 76, 74]);
    assert.deepEqual(decisions.map((decision) => decision.spans), [
      [uniqueSpan(source, boundaryHeading), uniqueSpan(source, boundaryBody)],
      [uniqueSpan(source, eligibleHeading)],
      [uniqueSpan(source, body400)],
      [uniqueSpan(source, mixedBody)],
      [uniqueSpan(source, fence)],
    ]);
    assert.deepEqual(decisions.map((decision) => decision.kinds), [
      ['colon-inferred', 'prose'],
      ['atx-heading'],
      ['prose'],
      ['prose', 'list', 'blockquote'],
      ['fenced-code'],
    ]);

    const allDecisionText = decisions.map((decision) => decision.text).join('\n');
    for (const sentinel of [
      'Boundary399:', 'BODY399_START', 'BODY399_END', 'HEADING50_START', 'HEADING50_END',
      'BODY400_START', 'BODY400_END', 'MIXED_START', 'MIXED_END', 'FENCE_START', 'FENCE_END',
    ]) {
      assert.equal(allDecisionText.split(sentinel).length - 1, 1, `${sentinel} must occur exactly once`);
    }
    assert.deepEqual(tokens(allDecisionText), tokens(source));
  }
});

test('indented code stays structural and uses only the shared word limits', () => {
  const code = `${words(30, '    code')}\n\n    ${words(30, 'more')}`;
  const result = prepareUnits(code).decisions;
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'selected');
  assert.equal(result[0].reason, null);
  assert.ok(result[0].text.includes('\n\n    more0'));

  const withHeading = prepareUnits(`## Example\n    ${words(55, 'code')}`).decisions;
  assert.equal(withHeading.length, 1);
  assert.equal(withHeading[0].status, 'selected');
  assert.equal(withHeading[0].headingAttached, true);

  const lazyContinuation = `${words(25)}\n    continuation ${words(25, 'tail')}`;
  const lazy = prepareUnits(lazyContinuation).decisions;
  assert.equal(lazy.length, 1);
  assert.equal(lazy[0].status, 'selected');
  assert.deepEqual(lazy[0].kinds, ['prose']);
  assert.equal(lazy[0].text, `${words(25)} continuation ${words(25, 'tail')}`);
});

test('all candidate decisions carry the complete stable shape', () => {
  const input = `Context:\n\nshort body\n\n${words(401)}`;
  const decisions = prepareUnits(input).decisions;
  assert.ok(decisions.length >= 2);
  for (const decision of decisions) {
    assert.deepEqual(Object.keys(decision), [
      'text', 'spans', 'kinds', 'headingAttached', 'headingKind',
      'inputWords', 'status', 'reason',
    ]);
    assert.ok(['selected', 'skipped'].includes(decision.status));
    assert.equal(decision.status === 'selected', decision.reason === null);
    for (const span of decision.spans) {
      assert.ok(Number.isInteger(span.start) && Number.isInteger(span.end));
      assert.ok(span.start >= 0 && span.end <= input.length && span.start <= span.end);
    }
  }
});

process.stdout.write(`\n${passed} fp-preprocess tests passed\n`);
