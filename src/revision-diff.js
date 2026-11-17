import { revisionOK } from './protocol.js';

export function comparisonIds(revisionId) {
  const [specId, version] = revisionId.split(':');
  const number = BigInt(version);
  return number > 1n
    ? { baseline: specId + ':' + (number - 1n), candidate: revisionId }
    : { baseline: revisionId, candidate: specId + ':2' };
}

export function validateRevisionPair(baseline, candidate) {
  if (!revisionOK(baseline) || !revisionOK(candidate)) {
    throw Error('Use revision IDs such as 1:1 and 1:2.');
  }
  const [baselineSpec, baselineVersion] = baseline.split(':');
  const [candidateSpec, candidateVersion] = candidate.split(':');
  if (baselineSpec !== candidateSpec) throw Error('Choose two revisions of the same specification.');
  if (BigInt(candidateVersion) <= BigInt(baselineVersion)) {
    throw Error('Choose a newer revision for the candidate.');
  }
}

export async function readRevisionPair(readRevision, baseline, candidate) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('Studionet read timed out. Try again.')), 20000);
  });
  const records = [baseline, candidate].map(async id => {
    let revision;
    try {
      revision = await readRevision(id);
    } catch (error) {
      throw Error('Could not load revision ' + id + '. Check that it is finalized on Studionet.', { cause: error });
    }
    if (revision?.revision_id !== id || !revision.clauses) {
      throw Error('Revision ' + id + ' was not found in finalized Studionet state.');
    }
    return revision;
  });
  try {
    return await Promise.race([Promise.all(records), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function diffClauses(before, after) {
  const changes = [];
  const counts = { added: 0, edited: 0, removed: 0, unchanged: 0 };
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

  for (const id of ids) {
    const previous = Object.hasOwn(before, id) ? before[id] : null;
    const current = Object.hasOwn(after, id) ? after[id] : null;
    if (previous === current) {
      counts.unchanged++;
      continue;
    }
    const kind = previous === null ? 'added' : current === null ? 'removed' : 'edited';
    counts[kind]++;
    changes.push({ id, kind, before: previous, after: current });
  }
  return { changes, counts };
}
