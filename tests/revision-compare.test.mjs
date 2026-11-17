import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClauses } from '../src/protocol.js';
import { comparisonIds, diffClauses, readRevisionPair, validateRevisionPair } from '../src/revision-diff.js';

test('compares by clause ID, regardless of input order', () => {
  const before = { kept: 'Same.', cadence: 'Two posts per week.', obsolete: 'Old requirement.' };
  const after = { cadence: 'Two posts each Monday through Sunday.', timezone: 'UTC.', kept: 'Same.' };
  assert.deepEqual(diffClauses(before, after), {
    changes: [
      { id: 'cadence', kind: 'edited', before: before.cadence, after: after.cadence },
      { id: 'obsolete', kind: 'removed', before: before.obsolete, after: null },
      { id: 'timezone', kind: 'added', before: null, after: after.timezone }
    ],
    counts: { added: 1, edited: 1, removed: 1, unchanged: 1 }
  });
});

test('a copied draft reports all clauses unchanged', () => {
  const before = { cadence: 'Two posts per week.' };
  const after = collectClauses(['cadence'], ['\u001cTwo posts per week. \u0085']);
  assert.deepEqual(diffClauses(before, after), {
    changes: [], counts: { added: 0, edited: 0, removed: 0, unchanged: 1 }
  });
});

test('accepts historical pairs within a spec, rejecting unrelated or reversed comparisons', () => {
  assert.doesNotThrow(() => validateRevisionPair('1:1', '1:3'));
  assert.throws(() => validateRevisionPair('1:1', '2:2'), /same specification/);
  assert.throws(() => validateRevisionPair('1:3', '1:1'), /newer/);
  assert.throws(() => validateRevisionPair('1:2', '1:2'), /newer/);
  assert.throws(() => validateRevisionPair('01:1', '1:2'), /revision IDs/);
});

test('prefills the previous published version without rounding large revision IDs', () => {
  assert.deepEqual(comparisonIds('4:1'), { baseline: '4:1', candidate: '4:2' });
  assert.deepEqual(comparisonIds('4:9007199254740995'), {
    baseline: '4:9007199254740994', candidate: '4:9007199254740995'
  });
});

test('binds comparison results to the exact requested published IDs', async () => {
  const old = { revision_id: '1:1', clauses: { cadence: 'Two posts per week.' } };
  const latest = { revision_id: '1:2', clauses: { cadence: 'Two posts each calendar week.' } };
  const calls = [];
  const read = async id => {
    calls.push(id);
    return id === old.revision_id ? old : latest;
  };
  const [baseline, candidate] = await readRevisionPair(read, '1:1', '1:2');
  assert.deepEqual(calls, ['1:1', '1:2']);
  assert.equal(diffClauses(baseline.clauses, candidate.clauses).counts.edited, 1);
  await assert.rejects(readRevisionPair(async () => old, '1:1', '1:2'), /Revision 1:2 was not found/);
});

test('drafts enforce the contract clause limits and handle special IDs like other IDs', () => {
  assert.throws(() => collectClauses(['a', 'a'], ['A', 'B']), /unique/);
  assert.throws(() => collectClauses(['a'], [' '.repeat(4)]), /nonempty/);
  assert.throws(() => collectClauses(['a'], ['x'.repeat(1201)]), /1200/);
  assert.throws(() => collectClauses(['a', 'b'], ['\t'.repeat(1200), 'B']), /nonempty/);
  const after = collectClauses(['__proto__', 'constructor'], ['One.', 'Two.']);
  assert.equal(JSON.stringify(after), '{"__proto__":"One.","constructor":"Two."}');
  assert.equal(diffClauses({}, after).counts.added, 2);
});
