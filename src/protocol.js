export const ADDRESS = '0xd8aD83d48Ae91F5B33321775D1D1aF6f5A97FEb1';
export const RPC = 'https://studio.genlayer.com/api';
export const CHAIN = '0xf22f';
export const EXPLORER = 'https://explorer-studio.genlayer.com';
export const FIELDS = ['clause_id','scenario','reading_a','outcome_a','reading_b','outcome_b'];
export const addressOK = x => /^0x[0-9a-f]{40}$/i.test(x) && !/^0x0{40}$/i.test(x);
export const revisionOK = x => typeof x === 'string' && /^[1-9]\d{0,77}:[1-9]\d{0,77}$/.test(x);
export const idOK = x => typeof x === 'string' && /^[1-9]\d{0,77}$/.test(x);
export const hashOK = x => typeof x === 'string' && /^0x[0-9a-f]{64}$/i.test(x);
export const sameAddress = (a,b) => !!a && !!b && a.toLowerCase()===b.toLowerCase();
const pyStrip = x => x.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,'');
export function collectClauses(ids, texts) {
  if (ids.length !== texts.length || ids.length < 1 || ids.length > 12) {
    throw Error('Use 1 to 12 clauses.');
  }
  const clauses = Object.create(null);
  let size = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i].trim();
    const wording = pyStrip(texts[i]);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || !wording || Object.hasOwn(clauses, id)) {
      throw Error('Use unique clause IDs and nonempty wording.');
    }
    const length = Array.from(wording).length;
    if (length > 1200) throw Error('Each clause must have at most 1200 characters.');
    clauses[id] = wording;
    size += length;
  }
  if (size > 6000) throw Error('Total wording must be 6000 characters or fewer.');
  if (Array.from(JSON.stringify(clauses)).length > 12000) {
    throw Error('Encoded terms exceed the contract input limit.');
  }
  return clauses;
}

export function cleanEvidence(input) {
  if (!input || Object.keys(input).length !== FIELDS.length) throw Error('Backup must contain exactly six evidence fields.');
  const evidence={};
  for(const key of [...FIELDS].sort()){
    if(typeof input[key]!=='string') throw Error('Missing evidence field: '+key);
    const value=pyStrip(input[key]);
    if(!value || Array.from(value).length>(key==='scenario'?1200:500)) throw Error('Check the length of '+key.replaceAll('_',' ')+'.');
    evidence[key]=value;
  }
  if(evidence.reading_a===evidence.reading_b || evidence.outcome_a===evidence.outcome_b) throw Error('Use distinct readings and distinct outcomes.');
  return evidence;
}
const hex = buf => Array.from(new Uint8Array(buf), b=>b.toString(16).padStart(2,'0')).join('');
export const randomSalt = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function commitment(revision, challenger, input, salt) {
  if(!revisionOK(revision)||!addressOK(challenger)||!/^[a-f0-9]{64}$/.test(salt)) throw Error('Invalid revision, wallet or salt.');
  let data=JSON.stringify(['SpecLock/v1',ADDRESS.toLowerCase(),revision,challenger.toLowerCase(),cleanEvidence(input),salt]);
  data=data.replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)));
}
export function phase(revision, now = Math.floor(Date.now()/1000)){
  if(revision.active) return 'Active';
  if(revision.superseded) return 'Superseded';
  if(now < Number(revision.commit_until)) return 'Commit open';
  if(now < Number(revision.reveal_until)) return 'Reveal open';
  if(Number(revision.blockers)>0) return 'Blocked';
  if(Number(revision.pending)>0) return 'Under review';
  return revision.accepted ? 'Ready to activate' : 'Awaiting acceptance';
}
export function outcome(receipt){
  if(receipt?.statusName!=='FINALIZED' && receipt?.status_name!=='FINALIZED') return {state:'Pending'};
  if(receipt.result_name!=='MAJORITY_AGREE') return {state:'Failed', detail:'Finalized without majority agreement.'};
  const raw=receipt.consensus_data?.leader_receipt;
  const leaders=Array.isArray(raw)?raw:[raw];
  const leader=leaders.filter(l=>l && l.genvm_result?.error_code!=='CONSENSUS_VALIDATOR_QUORUM_REACHED').at(-1);
  if(!leader) return {state:'Unverified',detail:'No completed execution receipt is available.'};
  const result=leader.result;
  if(leader.execution_result==='SUCCESS' && result?.status==='return') return {state:'Finalized', raw:result.payload?.raw};
  return {state:'Failed', detail:typeof result?.payload==='string'?result.payload:'The contract rejected this write.'};
}
