import test from 'node:test';
import assert from 'node:assert/strict';
import { commitment, cleanEvidence, phase, outcome } from '../src/protocol.js';
import { readFileSync } from 'node:fs';

const data=JSON.parse(readFileSync(new URL('../src/deployment.json',import.meta.url)));
const {confirmed_challenge: sample, blocked_revision: revision}=data.live_ai;
test('commitment uses the same canonical Unicode and stripping rules as the Python contract', async () => {
  const evidence={...sample.evidence,scenario:' \u001dA 🧪 é 雪 — B\u0085'};
  const actual=await commitment(revision.revision_id,sample.challenger,evidence,'ab'.repeat(32));
  assert.equal(actual,'16ce4d432aae971b9d13f7866d1fe160b3cc47ee68d8dddbc460857d547ce10a');
  assert.notEqual(await commitment('2:1',sample.challenger,evidence,'ab'.repeat(32)),actual);
});
test('invalid payloads are refused before hashing',()=>{
  assert.throws(()=>cleanEvidence({...sample.evidence,outcome_b:sample.evidence.outcome_a}));
  assert.throws(()=>cleanEvidence({...sample.evidence,extra:'x'}));
  assert.throws(()=>cleanEvidence({...sample.evidence,reading_a:'  '}));
});
test('revision phases observe commit and reveal boundaries and blockers',()=>{
  assert.equal(phase(revision,revision.commit_until-1),'Commit open');
  assert.equal(phase(revision,revision.commit_until),'Reveal open');
  assert.equal(phase(revision,revision.reveal_until),'Blocked');
  assert.equal(phase({...revision,blockers:0,pending:1},revision.reveal_until),'Under review');
  assert.equal(phase({...revision,blockers:0},revision.reveal_until),'Ready to activate');
});
test('finality distinguishes execution success, quorum cancellation and failure',()=>{
  const success={execution_result:'SUCCESS',result:{status:'return',payload:{raw:[5]}}};
  const idle={execution_result:'ERROR',genvm_result:{error_code:'CONSENSUS_VALIDATOR_QUORUM_REACHED'}};
  const receipt={statusName:'FINALIZED',result_name:'MAJORITY_AGREE',consensus_data:{leader_receipt:[success,idle]}};
  assert.deepEqual(outcome(receipt),{state:'Finalized',raw:[5]});
  assert.deepEqual(outcome({...receipt,statusName:'ACCEPTED'}),{state:'Pending'});
  assert.equal(outcome({...receipt,result_name:'DISAGREE'}).state,'Failed');
  assert.equal(outcome({...receipt,consensus_data:{leader_receipt:[idle]}}).state,'Unverified');
  assert.equal(outcome({...receipt,consensus_data:{leader_receipt:[{execution_result:'ERROR',result:{payload:'Closed'}}]}}).detail,'Closed');
});
