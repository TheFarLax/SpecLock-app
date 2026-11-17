import { collectClauses } from './protocol.js';
import { comparisonIds, diffClauses, readRevisionPair, validateRevisionPair } from './revision-diff.js';

const sampleWording = 'Publish exactly two posts in each Monday through Sunday calendar week, measured in UTC.';

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function renderComparison(output, before, after, baselineLabel, candidateLabel) {
  const {changes, counts} = diffClauses(before, after);
  const summary = textElement('p',
    counts.added + ' added · ' + counts.edited + ' edited · ' +
    counts.removed + ' removed · ' + counts.unchanged + ' unchanged',
    'compare-summary'
  );
  output.replaceChildren(summary);
  if (!changes.length) {
    output.append(textElement('p', 'The clause wording is identical.', 'hint'));
    output.focus();
    return;
  }

  for (const change of changes) {
    const article = document.createElement('article');
    article.className = 'compare-change compare-' + change.kind;
    const head = document.createElement('div');
    head.className = 'panel-bar';
    const kind = change.kind[0].toUpperCase() + change.kind.slice(1);
    head.append(textElement('h3', change.id), textElement('span', kind, 'badge'));
    const columns = document.createElement('div');
    columns.className = 'compare-columns';
    for (const [label, wording, missing] of [
      [baselineLabel, change.before, 'Clause absent from baseline'],
      [candidateLabel, change.after, 'Clause absent from candidate']
    ]) {
      const column = document.createElement('div');
      column.append(textElement('h4', label, 'small'));
      column.append(textElement('p', wording ?? missing, wording === null ? 'hint' : 'compare-wording'));
      columns.append(column);
    }
    article.append(head, columns);
    output.append(article);
  }
  output.focus();
}

export function openRevisionComparison({ revision, live, showDialog, clauseRow, readRevision }) {
  showDialog('Compare revision wording', '<form class="fields compare-form">' +
    '<label>Compare with<select name="source">' +
    '<option value="draft">Draft wording</option><option value="published">Published revision</option>' +
    '</select></label>' +
    '<div data-draft class="fields">' +
    '<p class="hint" data-draft-baseline></p>' +
    '<div id="clause-list"></div>' +
    '<div class="actions"><button type="button" class="button quiet" data-add-clause>＋ Add clause</button>' +
    '<button type="button" class="button quiet" data-example hidden>Try cadence example</button></div>' +
    '<p class="hint">Draft wording stays in this dialog.</p></div>' +
    '<fieldset class="compare-inputs" data-published hidden disabled>' +
    '<legend class="sr-only">Published revision IDs</legend>' +
    '<label>Baseline revision<input name="baseline" required maxlength="157" placeholder="1:1"></label>' +
    '<label>Candidate revision<input name="candidate" required maxlength="157" placeholder="1:2"></label>' +
    '</fieldset>' +
    '<p class="hint" data-compare-status role="status"></p>' +
    '<p class="error" data-compare-error role="alert" hidden></p>' +
    '<button class="button primary" type="submit">Compare changes</button>' +
    '</form><section class="compare-result" aria-label="Clause changes" aria-live="polite" tabindex="-1"></section>');

  const content = document.getElementById('dialog-content');
  const form = content.querySelector('.compare-form');
  const draft = form.querySelector('[data-draft]');
  const published = form.querySelector('[data-published]');
  const source = form.elements.source;
  const clauses = draft.querySelector('#clause-list');
  const example = draft.querySelector('[data-example]');
  const addClause = draft.querySelector('[data-add-clause]');
  const submit = form.querySelector('button[type=submit]');
  const status = form.querySelector('[data-compare-status]');
  const formError = form.querySelector('[data-compare-error]');
  const output = content.querySelector('.compare-result');
  const ids = comparisonIds(revision.revision_id);
  const baselineLabel = 'Revision ' + revision.revision_id + (live ? ' · Finalized' : ' · Deployment snapshot');
  let request = 0;

  function resetResult() {
    request++;
    output.replaceChildren();
    status.textContent = '';
    formError.hidden = true;
    submit.disabled = false;
  }

  function updateRemoveButtons() {
    const disabled = source.value !== 'draft' || clauses.children.length <= 1;
    for (const button of clauses.querySelectorAll('[data-remove]')) button.disabled = disabled;
  }

  function updateMode() {
    const isDraft = source.value === 'draft';
    draft.hidden = !isDraft;
    published.hidden = isDraft;
    published.disabled = isDraft;
    for (const control of draft.querySelectorAll('input, textarea, button')) {
      control.disabled = !isDraft;
    }
    updateRemoveButtons();
    resetResult();
  }

  form.elements.baseline.value = ids.baseline;
  form.elements.candidate.value = ids.candidate;
  draft.querySelector('[data-draft-baseline]').textContent = 'Baseline: ' + baselineLabel;
  for (const [id, wording] of Object.entries(revision.clauses)) {
    clauses.append(clauseRow(id, wording));
  }
  example.hidden = revision.revision_id !== '1:1' ||
    revision.clauses.cadence !== 'Publish two posts per week.';
  addClause.onclick = () => {
    if (clauses.children.length >= 12) {
      formError.textContent = 'A specification can contain up to 12 clauses.';
      formError.hidden = false;
      return;
    }
    const row = clauseRow();
    clauses.append(row);
    updateRemoveButtons();
    row.querySelector('input').focus();
    resetResult();
  };
  example.onclick = () => {
    const sample = { ...revision.clauses, cadence: sampleWording };
    clauses.replaceChildren(...Object.entries(sample).map(([id, wording]) => clauseRow(id, wording)));
    updateRemoveButtons();
    resetResult();
  };

  source.value = BigInt(revision.revision_id.split(':')[1]) > 1n ? 'published' : 'draft';
  updateMode();
  source.addEventListener('change', updateMode);
  form.addEventListener('input', resetResult);
  clauses.addEventListener('click', event => {
    if (event.target.closest('[data-remove]')) {
      updateRemoveButtons();
      resetResult();
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    resetResult();
    const currentRequest = request;
    const stillCurrent = () => currentRequest === request && form.isConnected;
    try {
      if (source.value === 'draft') {
        const data = new FormData(form);
        const proposed = collectClauses(data.getAll('clause_id'), data.getAll('clause_text'));
        renderComparison(output, revision.clauses, proposed, baselineLabel, 'Draft wording');
        return;
      }

      const baseline = form.elements.baseline.value.trim();
      const candidate = form.elements.candidate.value.trim();
      validateRevisionPair(baseline, candidate);
      status.textContent = 'Loading finalized Studionet revisions…';
      submit.disabled = true;
      const [before, after] = await readRevisionPair(readRevision, baseline, candidate);
      if (!stillCurrent()) return;
      renderComparison(output, before.clauses, after.clauses,
        'Revision ' + baseline + ' · Finalized', 'Revision ' + candidate + ' · Finalized');
    } catch (error) {
      if (!stillCurrent()) return;
      formError.textContent = String(error?.shortMessage || error?.message || 'Comparison failed.').slice(0, 480);
      formError.hidden = false;
    } finally {
      if (stillCurrent()) {
        submit.disabled = false;
        status.textContent = '';
      }
    }
  });
}
