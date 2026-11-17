import { createClient, abi } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { ADDRESS, RPC, CHAIN, EXPLORER, FIELDS, addressOK, revisionOK, idOK, hashOK, sameAddress, collectClauses, cleanEvidence, randomSalt, commitment, phase, outcome } from './protocol.js';
import { openRevisionComparison } from './revision-compare.js';
import deployment from './deployment.json';

const $ = id => document.getElementById(id);
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = x => x ? x.slice(0,8)+'…'+x.slice(-5) : '—';
const pill = (value,kind='')=>'<span class="badge '+kind+'">'+esc(value)+'</span>';
const date = x => new Date(Number(x)*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const writeBtn = (action,title,enabled=true)=>'<button type="button" class="button secondary" data-action="'+action+'" '+(enabled?'':'disabled')+'>'+esc(title)+'</button>';
const sample=deployment.live_ai.confirmed_challenge;
const state={wallet:null,network:null,liveRevision:false,liveChallenge:false,revision:deployment.live_ai.blocked_revision,challenge:sample,busy:false};
const reader=createClient({chain:studionet});
const modal=$('modal');
const provider=()=>window.ethereum;
const prefix='speclock:'+ADDRESS.toLowerCase()+':';
const labelVerdict=x=>({AMBIGUITY_CONFIRMED:'Ambiguity confirmed',NOT_DEMONSTRATED:'Not demonstrated',INCONCLUSIVE:'Inconclusive',PENDING:'Awaiting evaluation',COMMITTED:'Committed'}[x]||x);
const labelAction=x=>({register_spec:'Publish spec',publish_revision:'Publish revision',accept_revision:'Accept revision',commit_challenge:'Commit challenge',reveal_challenge:'Reveal challenge',evaluate_challenge:'Evaluate challenge',activate_spec:'Activate revision'}[x]||x);
const error=e=>String(e?.shortMessage||e?.message||e||'Unexpected error').slice(0,480);
const read=(method,...args)=>reader.readContract({address:ADDRESS,functionName:method,args,transactionHashVariant:'latest-final'});
function getStore(key){try{return JSON.parse(localStorage.getItem(prefix+key))??[];}catch{return [];}}
function setStore(key,value){localStorage.setItem(prefix+key,JSON.stringify(value));}
let toastTimer;
function toast(message,bad=false){const el=$('toast');el.textContent=message;el.classList.toggle('bad',bad);el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,6500);}
function renderWallet(){
  $('wallet').textContent=state.wallet?(state.network===CHAIN?short(state.wallet):'Switch to Studionet'):'Connect wallet';
  if(state.wallet)$('wallet').title=state.wallet;else $('wallet').removeAttribute('title');
}
function field(label,name,params=''){return '<label>'+esc(label)+'<input name="'+name+'" '+params+'></label>';}
function area(label,name,limit,value=''){return '<label>'+esc(label)+'<textarea name="'+name+'" maxlength="'+limit+'" required>'+esc(value)+'</textarea></label>';}
function meta(items){return '<dl class="meta">'+items.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>';}
function renderRevision(){
  const r=state.revision, p=phase(r);
  const mine=sameAddress(state.wallet,r.publisher), counter=sameAddress(state.wallet,r.counterparty);
  const now=Date.now()/1000, accepted=r.accepted===true, active=r.active===true;
  const live=state.liveRevision && !!state.wallet;
  $('revision-panel').innerHTML='<div class="panel-bar"><h2>Revision '+esc(r.revision_id)+'</h2>'+pill(p,Number(r.blockers)>0?'danger':active?'good':'')+'</div>'+
    Object.entries(r.clauses||{}).map(([k,v])=>'<div class="clause"><span class="small">'+esc(k)+'</span>'+esc(v)+'</div>').join('')+
    meta([['Counterparty',accepted?'Accepted':'Awaiting acceptance'],['Confirmed blockers',r.blockers],['Commit closes',date(r.commit_until)],['Reveal closes',date(r.reveal_until)],['Unresolved challenges',r.pending],['Credits per clause',r.credits_per_clause]])+
    '<div class="actions">'+writeBtn('commit','Commit challenge',live&&!mine&&!counter&&p==='Commit open')+
    writeBtn('compare','Compare wording')+
    (counter?writeBtn('accept','Accept revision',live&&!accepted&&!r.superseded):'')+
    (mine?writeBtn('revision','Publish revision',live&&!active&&!r.superseded):'')+
    (mine||counter?writeBtn('activate','Activate revision',live&&!r.superseded&&accepted&&!active&&now>=Number(r.reveal_until)&&!Number(r.blockers)&&!Number(r.pending)):'')+
    '</div><p class="checkline">'+(!state.wallet?'Connect a wallet to take part in a review.':!state.liveRevision?'Load finalized state to enable writes for this revision.':!mine&&!counter?'You are viewing as a challenger.':'You are viewing as a party to these terms.')+'</p>';
}
function evidenceHTML(c){
  const e=c.evidence;
  if(!e)return '<p>The evidence is hidden until the challenger reveals it.</p>';
  return '<p class="scenario">'+esc(e.scenario)+'</p>'+['a','b'].map(k=>'<div class="reading"><h3>Reading '+k.toUpperCase()+'</h3><p>'+esc(e['reading_'+k])+'</p><strong>'+esc(e['outcome_'+k])+'</strong></div>').join('');
}
function renderFeatured(){
  $('featured-panel').innerHTML='<div class="panel-bar"><h2>Featured challenge</h2>'+pill('Verified example')+'</div>'+
    '<span class="small">CHALLENGE '+esc(sample.challenge_id)+' · REVISION '+esc(sample.revision_id)+'</span>'+
    '<strong class="verdict">'+esc(labelVerdict(sample.status))+'</strong>'+evidenceHTML(sample)+
    '<a class="inline" href="#challenges" data-sample="true">Open challenge ↗</a>';
}
function renderChallenge(){
  const c=state.challenge, status=c.status;
  $('challenge-panel').innerHTML='<div class="panel-bar"><h2>Challenge '+esc(c.challenge_id)+'</h2>'+pill(labelVerdict(status),status==='AMBIGUITY_CONFIRMED'?'danger':'')+'</div>'+
    evidenceHTML(c)+meta([['Revision',c.revision_id],['Challenger',short(c.challenger)],['Credits awarded',c.credits_awarded],['Evaluations',c.attempts]])+
    '<div class="actions">'+writeBtn('reveal','Reveal evidence',state.liveChallenge&&sameAddress(state.wallet,c.challenger)&&status==='COMMITTED')+
    writeBtn('evaluate','Evaluate challenge',state.liveChallenge&&!!state.wallet&&['PENDING','INCONCLUSIVE'].includes(status))+'</div>'+
    (!state.liveChallenge?'<p class="checkline">Showing the recorded challenge. Load finalized state for actions.</p>':'');
}
function renderBackups(){
  const backups=getStore('backups');
  $('backup-panel').innerHTML='<div class="panel-bar"><h2>Reveal backups</h2></div><p>Export the evidence and salt before switching devices. Keep the file private until the reveal window.</p>'+
    (backups.length?backups.map((b,i)=>'<div class="storage-row"><span>Revision '+esc(b.revision)+'<br><span class="small">'+esc(short(b.challenger))+' · '+esc(b.challengeId?'Challenge '+b.challengeId:'Commitment prepared')+'</span></span><button class="button quiet" data-backup="'+i+'">Export</button></div>').join(''):'<p class="checkline">No backups stored in this browser.</p>')+
    '<div class="actions" style="margin-top:12px"><button class="button secondary" data-action="import">Import backup</button></div>';
}
function renderActivity(){
  const list=getStore('activity');
  $('activity-panel').innerHTML=list.length?list.map(item=>'<div class="activity-row"><div><strong>'+esc(labelAction(item.method))+'</strong><span class="small">'+esc(item.detail||new Date(item.at).toLocaleString())+'</span><a class="inline" href="'+EXPLORER+'/transactions/'+esc(item.hash)+'" target="_blank" rel="noreferrer">'+esc(short(item.hash))+' ↗</a></div><div class="actions">'+pill(item.state,item.state==='Finalized'?'good':item.state==='Failed'?'danger':'')+(item.state==='Pending'||item.state==='Unverified'?'<button class="button quiet" data-check="'+esc(item.hash)+'">Check status</button>':'')+'</div></div>').join(''):'<h2>No transactions yet</h2><p>Signed actions from this browser will appear here.</p>';
}
function render(){renderWallet();renderRevision();renderChallenge();renderBackups();renderActivity();}
function route(){
  const name=location.hash.slice(1);
  const selected=['workbench','challenges','activity','guide'].includes(name)?name:'workbench';
  document.querySelectorAll('[data-page]').forEach(p=>p.hidden=p.id!==selected);
  document.querySelectorAll('[data-nav]').forEach(a=>a.dataset.nav===selected?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));
}
async function loadRevision(id){
  if(!revisionOK(id))throw Error('Enter a revision ID such as 1:1.');
  const revision=await read('get_revision',id);
  if(!revision || revision.revision_id!==id)throw Error('Revision not found.');
  state.revision=revision;state.liveRevision=true;$('revision-id').value=id;renderRevision();
  $('source-status').textContent='Showing finalized Studionet state.';
}
async function loadChallenge(id){
  if(!idOK(id))throw Error('Enter a challenge ID such as 1.');
  const challenge=await read('get_challenge',id);
  if(!challenge || challenge.challenge_id!==id)throw Error('Challenge not found.');
  state.challenge=challenge;state.liveChallenge=true;$('challenge-id').value=id;renderChallenge();
}
async function refreshStats(){
  try{
    const counts=await read('get_counts');
    $('stat-specs').textContent=counts.specs;$('stat-challenges').textContent=counts.challenges;
  }catch{}
  const wallet=state.wallet;
  $('stat-credits').textContent='—';
  if(wallet)try{const credits=await read('get_credits',wallet);if(wallet===state.wallet)$('stat-credits').textContent=credits;}catch{}
}
function updateWallet(accounts,chain){
  state.wallet=accounts?.[0]||null;state.network=chain??state.network;
  render();void refreshStats();
}
async function connect(){
  const p=provider();
  if(!p)throw Error('No wallet detected. Open this page in an EIP-1193 wallet browser or enable a browser wallet.');
  const accounts=await p.request({method:'eth_requestAccounts'});
  if(!accounts[0])throw Error('The wallet did not share an account.');
  let chain=await p.request({method:'eth_chainId'});
  updateWallet(accounts,chain);
  if(chain!==CHAIN){
    try{await p.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN}]});}
    catch(e){
      if(Number(e.code)!==4902)throw e;
      await p.request({method:'wallet_addEthereumChain',params:[{chainId:CHAIN,chainName:'GenLayer Studionet',nativeCurrency:{name:'GEN',symbol:'GEN',decimals:18},rpcUrls:[RPC],blockExplorerUrls:[EXPLORER]}]});
    }
    chain=await p.request({method:'eth_chainId'});
    updateWallet(accounts,chain);
    if(chain!==CHAIN)throw Error('Select GenLayer Studionet in your wallet.');
  }
  return accounts[0];
}
function addActivity(item){
  const list=getStore('activity');
  const idx=list.findIndex(x=>sameAddress(x.hash,item.hash));
  if(idx<0)list.unshift(item);else list[idx]={...list[idx],...item};
  setStore('activity',list.slice(0,80));renderActivity();
}
async function applyResult(item,result){
  if(item.method==='register_spec'||item.method==='publish_revision'){
    if(revisionOK(result))await loadRevision(result);
  }else if(item.method==='commit_challenge'){
    if(idOK(result)){
      const backups=getStore('backups');
      const b=backups.find(x=>x.digest===item.digest);
      if(b){b.challengeId=result;setStore('backups',backups);renderBackups();}
      await loadChallenge(result);location.hash='challenges';
    }
  }else if(item.method==='accept_revision'||item.method==='activate_spec'){
    await loadRevision(item.id);
  }else if(item.method==='reveal_challenge'||item.method==='evaluate_challenge'){
    await loadChallenge(item.id);
    if(state.revision.revision_id===state.challenge.revision_id)await loadRevision(state.revision.revision_id);
  }
  void refreshStats();
}
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function track(item,poll=false){
  let verdict=null;
  for(let i=0;i<(poll?14:1);i++){
    try{verdict=outcome(await reader.getTransaction({hash:item.hash}));}
    catch(e){verdict={state:'Pending',detail:'Receipt not available yet.'};}
    addActivity({...item,state:verdict.state,detail:verdict.detail||''});
    if(verdict.state!=='Pending')break;
    if(poll && i<13)await delay(4500);
  }
  if(verdict?.state==='Finalized'){
    try{const result=verdict.raw ? abi.calldata.decode(Uint8Array.from(verdict.raw)) : undefined;await applyResult(item,result);}
    catch(e){toast('Transaction finalized. Reload the record to see the latest state.',true);}
  }
  return verdict;
}
function showDialog(title,body){
  $('dialog-title').textContent=title;
  $('dialog-content').innerHTML=body;
  if(!modal.open)modal.showModal();
}
function summaryForm(body,submit){
  return '<form class="fields" id="action-form">'+body+'<p class="hint">Writes are signed in your wallet on Studionet.</p><div class="error" id="form-error" role="alert" hidden></div><button class="button primary" type="submit">'+esc(submit)+'</button></form>';
}
function bindForm(fn){
  $('action-form').addEventListener('submit',async ev=>{
    ev.preventDefault();
    const f=ev.currentTarget, btn=f.querySelector('button[type=submit]');
    const out=f.querySelector('#form-error');
    btn.disabled=true;out.hidden=true;
    try{await fn(new FormData(f),f);}catch(e){out.textContent=error(e);out.hidden=false;}
    finally{btn.disabled=false;}
  });
}
async function write(method,args,info={}){
  if(state.busy)throw Error('A wallet request is already in progress.');
  state.busy=true;
  let hash;
  try{
    const p=provider();
    if(!p||!state.wallet)throw Error('Connect your wallet first.');
    const [accounts,chain]=await Promise.all([p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})]);
    if(!sameAddress(accounts[0],state.wallet)||chain!==CHAIN)throw Error('Reconnect your wallet on Studionet.');
    if(info.wallet&&!sameAddress(info.wallet,accounts[0]))throw Error('This action belongs to a different wallet.');
    const client=createClient({chain:studionet,account:accounts[0],provider:p});
    hash=await client.writeContract({address:ADDRESS,functionName:method,args,value:0n,leaderOnly:false});
    if(!hashOK(hash))throw Error('Wallet returned an invalid hash. Check wallet activity before trying again.');
  }finally{state.busy=false;}
  const item={hash,method,at:Date.now(),state:'Pending',id:info.id,digest:info.digest};
  try{addActivity(item);}catch{toast('Save this transaction hash: '+hash,true);}
  modal.close();
  toast('Transaction submitted. See Activity for finality.');
  void track(item,true).then(v=>{if(v?.state==='Finalized')toast(labelAction(method)+' finalized.');if(v?.state==='Failed')toast(v.detail,true);}).catch(e=>toast(error(e),true));
}
function clauseRow(id='',text=''){
  const row=document.createElement('div');row.className='clause-edit';
  row.innerHTML=field('Clause ID','clause_id','required maxlength="32" pattern="[A-Za-z0-9_\\-]+" placeholder="cadence" value="'+esc(id)+'"')+area('Clause wording','clause_text',1200,text)+'<div class="actions"><button class="button quiet" type="button" data-remove>Remove clause</button></div>';
  row.querySelector('[data-remove]').onclick=()=>{if($('clause-list').children.length>1)row.remove();};
  return row;
}
function publishForm(isRevision){
  const r=state.revision;
  const initial=isRevision?Object.entries(r.clauses):[['','']];
  const id=r.revision_id;
  showDialog(isRevision?'Publish revised terms':'New specification',summaryForm(
    (isRevision?'<p class="hint">Update revision '+esc(id)+' and open a fresh review window.</p>':
    field('Counterparty wallet','counterparty','required placeholder="0x…" maxlength="42"')+
    '<div class="field-row extended">'+field('Commit seconds','commit','type="number" required min="60" max="604800" value="3600"')+field('Reveal seconds','reveal','type="number" required min="60" max="604800" value="3600"')+field('Credits per clause','credits','type="number" required min="1" max="1000" value="7"')+'</div>')+
    '<div id="clause-list"></div><button type="button" class="button quiet" id="add-clause">＋ Add clause</button>',isRevision?'Sign revised terms':'Sign and publish'));
  for(const item of initial)$('clause-list').append(clauseRow(...item));
  $('add-clause').onclick=()=>{const wrap=$('clause-list');if(wrap.children.length<12){const row=clauseRow();wrap.append(row);row.querySelector('input').focus();}else toast('A spec can contain up to 12 clauses.',true);};
  bindForm(async data=>{
    const encoded=JSON.stringify(collectClauses(data.getAll('clause_id'),data.getAll('clause_text')));
    if(isRevision){await write('publish_revision',[String(r.spec_id),encoded],{id});return;}
    const other=data.get('counterparty').trim();
    if(!addressOK(other)||sameAddress(other,state.wallet))throw Error('Enter a valid wallet different from yours.');
    await write('register_spec',[other,encoded,Number(data.get('commit')),Number(data.get('reveal')),Number(data.get('credits'))]);
  });
}
function saveBackup(b){
  const backups=getStore('backups'), index=backups.findIndex(x=>x.digest===b.digest);
  if(index<0)backups.push(b);else backups[index]={...backups[index],...b,challengeId:b.challengeId||backups[index].challengeId};
  setStore('backups',backups);renderBackups();
}
function download(b){
  const blob=new Blob([JSON.stringify(b,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=url;a.download='speclock-reveal-'+b.revision.replace(':','-')+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function commitForm(){
  const r=state.revision, challenger=state.wallet;
  showDialog('Prepare challenge',summaryForm(
    '<p class="hint">Revision '+esc(r.revision_id)+'. Describe one scenario and how two readings change its outcome.</p>'+
    '<label>Clause<select name="clause_id">'+Object.keys(r.clauses).map(k=>'<option value="'+esc(k)+'">'+esc(k)+'</option>').join('')+'</select></label>'+
    area('Shared scenario','scenario',1200)+area('First reading','reading_a',500)+area('Outcome under first reading','outcome_a',500)+area('Second reading','reading_b',500)+area('Outcome under second reading','outcome_b',500),'Prepare reveal backup'));
  bindForm(async data=>{
    const evidence=cleanEvidence(Object.fromEntries(FIELDS.map(k=>[k,data.get(k)])));
    const salt=randomSalt(), digest=await commitment(r.revision_id,challenger,evidence,salt);
    const backup={version:1,contract:ADDRESS,challenger,revision:r.revision_id,evidence,salt,digest};
    saveBackup(backup);
    showDialog('Save your reveal backup',summaryForm('<p>Keep the backup private until reveal opens. A copy is stored in this browser.</p><div class="notice"><b>Commitment digest</b><br>'+esc(digest)+'</div><button class="button quiet" type="button" id="export-now">Download backup</button>','Sign commitment'));
    $('export-now').onclick=()=>download(backup);
    bindForm(async()=>write('commit_challenge',[r.revision_id,digest],{id:r.revision_id,digest,wallet:challenger}));
  });
}
async function revealForm(){
  const c=state.challenge, r=await read('get_revision',c.revision_id);
  const b=getStore('backups').find(x=>x.digest===c.digest&&sameAddress(x.challenger,state.wallet));
  if(!b)throw Error('Import the reveal backup for this challenge first.');
  const now=Date.now()/1000;
  if(now<Number(r.commit_until))throw Error('Reveal opens '+date(r.commit_until)+'.');
  if(now>=Number(r.reveal_until))throw Error('The reveal window has closed.');
  if(await commitment(c.revision_id,state.wallet,b.evidence,b.salt)!==c.digest)throw Error('Backup does not match the on-chain commitment.');
  showDialog('Reveal challenge '+c.challenge_id,summaryForm('<p>The evidence and salt become public when submitted.</p>'+evidenceHTML({evidence:b.evidence}),'Sign reveal'));
  bindForm(async()=>write('reveal_challenge',[c.challenge_id,JSON.stringify(b.evidence),b.salt],{id:c.challenge_id,wallet:c.challenger}));
}
function importForm(){
  showDialog('Import reveal backup',summaryForm('<p>Choose the JSON file exported when preparing the challenge.</p><label>Backup file<input type="file" accept=".json,application/json" required id="backup-file"></label>','Import backup'));
  bindForm(async()=>{
    const file=$('backup-file').files[0];if(!file||file.size>30000)throw Error('Choose a valid backup under 30 KB.');
    const b=JSON.parse(await file.text());
    if(b.version!==1||!sameAddress(b.contract,ADDRESS)||!addressOK(b.challenger))throw Error('Backup belongs to another contract or format.');
    const evidence=cleanEvidence(b.evidence), digest=await commitment(b.revision,b.challenger,evidence,b.salt);
    if(digest!==b.digest)throw Error('The backup digest does not match its evidence.');
    saveBackup({version:1,contract:ADDRESS,revision:b.revision,challenger:b.challenger,evidence,salt:b.salt,digest,challengeId:idOK(b.challengeId)?b.challengeId:null});
    modal.close();toast('Reveal backup imported.');
  });
}
function confirm(title,text,method,id){
  const wallet=state.wallet;
  showDialog(title,summaryForm('<p>'+esc(text)+'</p>','Sign transaction'));
  bindForm(async()=>write(method,[id],{id,wallet}));
}
async function action(name){
  if(name==='import'){importForm();return;}
  if(name==='compare'){
    openRevisionComparison({
      revision: state.revision,
      live: state.liveRevision,
      showDialog,
      clauseRow,
      readRevision: id => read('get_revision', id)
    });
    return;
  }
  if(!state.wallet){await connect();if(name!=='publish')return;}
  if(state.network!==CHAIN)await connect();
  const r=state.revision,c=state.challenge;
  if(name==='publish')publishForm(false);
  if(name==='revision')publishForm(true);
  if(name==='commit')commitForm();
  if(name==='reveal')await revealForm();
  if(name==='accept')confirm('Accept revision '+r.revision_id,'Accept this exact version of the terms as the named counterparty.','accept_revision',r.revision_id);
  if(name==='activate')confirm('Activate revision '+r.revision_id,'Activate the accepted version after the review window closes.','activate_spec',r.revision_id);
  if(name==='evaluate')confirm('Evaluate challenge '+c.challenge_id,'Validators will review the revealed terms and evidence. A verdict appears after consensus finalizes.','evaluate_challenge',c.challenge_id);
}
document.addEventListener('click',ev=>{
  const node=ev.target.closest('[data-action],[data-backup],[data-check],[data-sample]');
  if(!node)return;
  if(node.dataset.action)void action(node.dataset.action).catch(e=>toast(error(e),true));
  if(node.dataset.backup!==undefined){const b=getStore('backups')[Number(node.dataset.backup)];if(b)download(b);}
  if(node.dataset.check){const item=getStore('activity').find(x=>x.hash===node.dataset.check);if(item){node.disabled=true;void track(item).then(v=>toast(v?.state==='Pending'?'Still awaiting finality.':v?.state||'Receipt unavailable')).catch(e=>toast(error(e),true)).finally(()=>node.disabled=false);}}
  if(node.dataset.sample)void loadChallenge(sample.challenge_id).catch(()=>{});
});
function lookup(form,input,fn){
  $(form).addEventListener('submit',async e=>{
    e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;
    try{await fn($(input).value.trim());}catch(e){toast(error(e),true);}finally{b.disabled=false;}
  });
}
lookup('revision-lookup','revision-id',loadRevision);
lookup('challenge-lookup','challenge-id',loadChallenge);
$('close-modal').onclick=()=>modal.close();
$('wallet').onclick=()=>void connect().catch(e=>toast(error(e),true));
window.addEventListener('hashchange',route);
provider()?.on?.('accountsChanged',accounts=>updateWallet(accounts));
provider()?.on?.('chainChanged',chain=>{state.network=chain;renderWallet();});
route();render();renderFeatured();
void loadRevision('1:1').catch(()=>{$('source-status').textContent='Studionet is unavailable. Showing the verified deployment snapshot.';});
void loadChallenge('1').catch(()=>{});
void refreshStats();
if(provider())void Promise.all([provider().request({method:'eth_accounts'}),provider().request({method:'eth_chainId'})]).then(([a,c])=>updateWallet(a,c)).catch(()=>{});
setInterval(()=>{if(!modal.open&&!$('workbench').hidden)renderRevision();},30000);
