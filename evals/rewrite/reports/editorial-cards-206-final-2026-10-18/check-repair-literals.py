"""Check these retained receipts, not future paraphrases or semantic quality."""
from copy import deepcopy
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
INPUTS = json.loads((ROOT / 'repair-inputs.json').read_text(encoding='utf-8-sig'))
HEADING = re.compile(r'^(?:#{1,6}\s*)?(?:\*\*)?Final rewrite(?:\*\*)?:?\s*$', re.M | re.I)
BOUNDARY = re.compile(r'\n(?:#{1,6}\s*)?(?:\*\*)?(?:Changes|Verification|Issues found)[^\n]*\n', re.I)


def check(responses):
    assert set(responses) == {case['id'] for case in INPUTS}, 'incomplete responses'
    for case in INPUTS:
        response = responses[case['id']]
        headings = list(HEADING.finditer(response))
        assert len(headings) == 1, 'expected one final artifact'
        tail = response[headings[0].end():]
        boundary = BOUNDARY.search(tail)
        assert boundary, 'missing report boundary'
        final = tail[:boundary.start()].strip()
        assert final, 'empty final artifact'
        if case['id'] == 'technical-03':
            assert final.startswith('The cache key includes the account ID. '), 'untargeted first sentence'
            assert final.endswith('The active account is not necessarily the right one.'), 'untargeted last sentence'
        if case['id'] == 'personal-03':
            assert final == case['source'], 'punctuation-only retained no-op'
        if case['id'] == 'ec-grounded-reaction-edit':
            assert 'most interesting' in final and '31' in final, 'retained ranking/count'
        if case['id'] == 'ec-earned-reversal-edit':
            assert 'every failure mode except' in final and 'every path except' in final, 'retained breadth'
        for term in ['detector', 'marks normalizer', 'preservation validator']:
            assert term in response.lower(), 'unavailable check not named'
        assert 'model-only' in response.lower(), 'assessment not labeled'


families = {
    family: json.loads((ROOT / f'{family}-repair-responses.json').read_text(encoding='utf-8'))
    for family in ['haiku', 'codex']
}
for responses in families.values():
    check(responses)

mutations = [
    ('technical-03', 'The cache key includes the account ID.', 'The cache key omits the account ID.'),
    ('personal-03', 'The apartment was smaller', 'The apartment was larger'),
    ('ec-grounded-reaction-edit', 'most interesting', 'ordinary'),
    ('ec-earned-reversal-edit', 'every failure mode except', 'a failure mode including'),
    ('technical-02', 'preservation validator', 'validator'),
    ('casual-02', '**Final rewrite**', '**Final rewrite**\n\n**Final rewrite**'),
]
for case, original, replacement in mutations:
    candidate = deepcopy(families['haiku'])
    assert original in candidate[case], 'control no longer targets retained receipt'
    candidate[case] = candidate[case].replace(original, replacement)
    try:
        check(candidate)
    except AssertionError:
        continue
    raise AssertionError(f'mutation passed: {case}: {original}')

print('32 retained repair responses checked; six negative mutation controls rejected. Semantic judgments remain separate.')
