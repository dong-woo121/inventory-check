'use strict';
(() => {
  const core = window.InventoryCore;
  const STORAGE_CONFIG='inventory-cloud-connection-v1';
  const STORAGE_SESSION='inventory-cloud-session-v1';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const state={config:null,session:null,profile:null,settings:null,products:[],requests:[],result:null,history:[],historySelected:null};
  function message(msg,bad=false){$('notice').textContent=msg;$('notice').classList.toggle('bad',bad)}
  function show(id,yes){$(id).hidden=!yes}
  function getConfig(){try{return JSON.parse(localStorage.getItem(STORAGE_CONFIG)||'null')}catch{return null}}
  function getSession(){try{return JSON.parse(sessionStorage.getItem(STORAGE_SESSION)||'null')}catch{return null}}
  function setSession(s){state.session=s;if(s)sessionStorage.setItem(STORAGE_SESSION,JSON.stringify(s));else sessionStorage.removeItem(STORAGE_SESSION)}
  function requireConfig(){if(!state.config)throw Error('먼저 Supabase URL 및 publishable 키를 저장해 주세요.');}
  function base(){return state.config.url.replace(/\/$/,'')}
  async function request(path,{method='GET',body,token=true,headers={}}={}){
    requireConfig();const h={'apikey':state.config.key,...headers};
    if(token&&state.session?.access_token)h.Authorization='Bearer '+state.session.access_token;
    if(body!==undefined)h['Content-Type']='application/json';
    const make=()=>fetch(base()+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
    let resp=await make();
    if(resp.status===401&&token&&state.session?.refresh_token){
      await refreshSession();h.Authorization='Bearer '+state.session.access_token;resp=await make();
    }
    const raw=await resp.text();let data;
    try{data=raw?JSON.parse(raw):null;}catch{data=raw}
    if(!resp.ok)throw Error((data&&typeof data==='object'&&(data.message||data.msg||data.error_description||data.error))||`${resp.status} ${String(data).slice(0,200)}`);
    return data;
  }
  async function refreshSession(){
    if(!state.session?.refresh_token)throw Error('세션이 만료되었습니다. 다시 로그인해 주세요.');
    const h={'apikey':state.config.key,'Content-Type':'application/json'};
    const resp=await fetch(base()+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:h,body:JSON.stringify({refresh_token:state.session.refresh_token}),cache:'no-store'});
    const data=await resp.json();if(!resp.ok){setSession(null);throw Error('세션이 만료되었습니다. 다시 로그인해 주세요.');}
    setSession(data);
  }
  async function login(email,password){
    const data=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},token:false});
    if(!data.access_token||!data.refresh_token)throw Error('로그인 토큰을 받지 못했습니다.');
    setSession(data);await openWorkspace();
  }
  async function openWorkspace(){
    const user=await request('/auth/v1/user');
    const profiles=await request('/rest/v1/profiles?select=user_id,email,display_name,role&user_id=eq.'+encodeURIComponent(user.id));
    if(!profiles?.length)throw Error('작업자 프로필이 없습니다. DB 초기화 SQL을 확인해 주세요.');
    state.profile=profiles[0];
    $('identity').textContent=state.profile.display_name||state.profile.email;
    $('role-tag').textContent=state.profile.role==='admin'?'관리자':'일반 작업자';
    show('login-panel',false);show('config-panel',false);show('workspace',true);
    show('admin-panel',state.profile.role==='admin');
    await loadCatalog();await Promise.all([loadHistory(),loadRequests()]);
    message('공용 상품 사전 및 작업 이력을 불러왔습니다.');
  }
  async function loadCatalog(){
    const root='/rest/v1/';
    const [products,aliases,bundles,bundleAliases,components,gifts]=await Promise.all([
      request(root+'products?select=id,name,display_order,active&active=eq.true&order=display_order.asc'),
      request(root+'product_aliases?select=product_id,label'),
      request(root+'bundles?select=id,name,active&active=eq.true'),
      request(root+'bundle_aliases?select=bundle_id,label'),
      request(root+'bundle_components?select=bundle_id,product_id,quantity'),
      request(root+'gift_rules?select=label')
    ]);
    if(!products.length)throw Error('공용 상품 사전이 비어 있습니다. supabase/002_seed.sql을 실행해 주세요.');
    const ps=products.map(p=>({id:p.id,name:p.name,aliases:aliases.filter(a=>a.product_id===p.id).map(a=>a.label)}));
    const nameById=new Map(ps.map(p=>[p.id,p.name]));
    const sets=bundles.map(b=>({aliases:[b.name,...bundleAliases.filter(a=>a.bundle_id===b.id).map(a=>a.label)],components:components.filter(c=>c.bundle_id===b.id).map(c=>({name:nameById.get(c.product_id),qty:c.quantity}))}));
    const settings={products:ps,sets,gifts:gifts.map(g=>g.label)};
    core.validateSettings(settings);
    state.settings=settings;state.products=ps;
    // Never keep using potentially stale totals after the shared catalog changes.
    if(state.result&&$('orders').value.trim())recalculate();
    return settings;
  }
  function recalculate(){
    if(!state.settings)throw Error('공용 상품 사전이 아직 준비되지 않았습니다.');
    state.result=core.analyze($('orders').value,state.settings);
    renderResult();return state.result;
  }
  function renderResult(){
    const r=state.result;show('results',true);
    $('quantity-total').textContent=r.count.toLocaleString('ko-KR');
    $('line-total').textContent=r.audit.length.toLocaleString('ko-KR');
    const err=r.audit.filter(x=>x.status==='error').length;
    $('error-total').textContent=err;
    $('result-info').textContent=err?`⚠ 오류 ${err}행: 해당 행 전체를 제외했습니다. 미인식 매핑은 승인 전까지 합산되지 않습니다.`:'검증 완료 · 엑셀 수량 복사가 가능합니다.';
    $('totals-body').innerHTML=state.products.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.name)}</td><td class="num">${r.totals.get(p.name)}</td></tr>`).join('');
    $('audit-body').innerHTML=r.audit.map(row=>`<tr><td>${row.line}</td><td class="${row.status==='error'?'badtext':'goodtext'}">${esc(row.status)}</td><td>${esc(row.original)}<div class="hint">${esc(row.message)}</div></td></tr>`).join('');
    $('save-batch').disabled=!r.audit.length;
    $('copy-qty').disabled=r.hasErrors||!r.audit.length;
    renderUnknowns(r);
  }
  function renderUnknowns(r){
    const grouped=new Map();
    for(const row of r.audit)if(row.status==='error')for(const issue of row.issues||[]){
      if(!issue.unknownLabel)continue;
      const key=core.norm(issue.unknownLabel);
      if(!grouped.has(key))grouped.set(key,{label:issue.unknownLabel,lines:[]});
      grouped.get(key).lines.push(row.line);
    }
    const values=[...grouped.values()];
    $('unknown-list').innerHTML=values.length?values.map((u,i)=>{
      const candidates=core.suggestedProducts(u.label,state.products);
      const first=candidates[0];
      const options=['<option value="">승인 요청할 상품 선택</option>',...candidates.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`)];
      return `<div class="unknown" data-index="${i}"><b>${esc(u.label)}</b><div class="hint">원본 ${u.lines.join(', ')}행 · ${u.lines.length}회 등장 · ${first&&first.score>=0.5?'추천 '+esc(first.name)+' ('+Math.round(first.score*100)+'%)':'유력한 후보 없음'}</div><div class="tools"><select aria-label="실제 상품 후보">${options.join('')}</select><button class="secondary" data-request="${i}">관리자 승인 요청</button></div><div class="hint">추천은 참고용입니다. 관리자 승인 전에는 집계되지 않습니다.</div></div>`;
    }).join(''):'<p class="goodtext">미인식 항목이 없습니다.</p>';
    state.unknowns=values;
  }
  function snapshot(){
    const r=state.result;
    return {schema_version:1,products:state.products.map(p=>({id:p.id,name:p.name,quantity:r.totals.get(p.name)})),total_quantity:r.count,has_errors:r.hasErrors,
      products_order:state.products.map(p=>p.id),catalog_captured_at:new Date().toISOString()};
  }
  function linesSnapshot(){
    // Snapshot each row's source and recognized item quantities, including error/gift rows.
    const r=state.result;
    return r.audit.map(a=>({line:a.line,original:a.original,status:a.status,message:a.message,items:a.status==='ok'?parseRecognizedItems(a):[]}));
  }
  function parseRecognizedItems(a){
    const idx=core.buildIndex(state.settings),out=[];
    for(const part of a.content.split(/\s*[+＋]\s*/)){
      const x=core.parseItem(part,idx);
      if(x.type==='product')out.push({name:x.name,quantity:x.count});
      if(x.type==='set')for(const c of x.components)out.push({name:c.name,quantity:c.count});
    }
    return out;
  }
  async function saveBatch(){
    if(!state.result||!state.result.audit.length)throw Error('저장할 주문이 없습니다.');
    const raw=$('orders').value;
    // Force recomputation from the exact current input before persistence.
    const r=recalculate();
    const created=await request('/rest/v1/rpc/save_inventory_batch',{method:'POST',body:{
      p_title:$('batch-title').value.trim()||'주문 취합',p_batch_date:$('batch-date').value||null,
      p_raw_text:raw,p_snapshot:snapshot(),p_lines:linesSnapshot()
    }});
    message(`작업 저장 완료: ${created}${r.hasErrors?' (오류 행 포함 · 검증 필요)':''}`);
    await loadHistory();
  }
  async function loadHistory(){
    state.history=await request('/rest/v1/order_batches?select=id,title,batch_date,created_at,created_by,row_count,error_count,total_quantity,status,result_snapshot,raw_text&order=created_at.desc&limit=100');
    const profiles=await request('/rest/v1/profiles?select=user_id,email,display_name');
    const owner=new Map(profiles.map(p=>[p.user_id,p.display_name||p.email]));
    $('history-body').innerHTML=state.history.map((h,i)=>`<tr><td>${esc(new Date(h.created_at).toLocaleString('ko-KR'))}</td><td>${esc(h.title)}</td><td>${esc(owner.get(h.created_by)||'작업자')}</td><td>${h.row_count}</td><td class="${h.error_count?'badtext':''}">${h.error_count}</td><td>${h.total_quantity}</td><td><button class="secondary" data-history="${i}">열기</button></td></tr>`).join('')||'<tr><td colspan="7">저장된 기록이 없습니다.</td></tr>';
  }
  function showHistory(index){
    const h=state.history[index];if(!h)return;
    state.historySelected=h;
    $('history-preview').textContent=JSON.stringify({title:h.title,date:h.batch_date,created_at:h.created_at,
      status:h.status,error_count:h.error_count,products:h.result_snapshot.products,raw_text:h.raw_text},null,2);
    $('history-copy').disabled=h.error_count!==0;
    show('history-detail',true);
  }
  async function copy(text){
    try{await navigator.clipboard.writeText(text);return;}catch{}
    const input=document.createElement('textarea');input.value=text;document.body.appendChild(input);input.select();document.execCommand('copy');input.remove();
  }
  async function requestAlias(group,productId){
    if(!productId)throw Error('요청할 실제 상품을 선택하세요.');
    await request('/rest/v1/alias_requests',{method:'POST',body:{proposed_label:group.label,suggested_product_id:productId},headers:{Prefer:'return=minimal'}});
    message(`「${group.label}」 별칭 승인 요청을 등록했습니다. 관리자가 승인하면 공용 사전에 반영됩니다.`);
    await loadRequests();
  }
  async function loadRequests(){
    const isAdmin=state.profile?.role==='admin';
    const all=await request('/rest/v1/alias_requests?select=id,proposed_label,suggested_product_id,status,requested_by,created_at,reviewed_at&order=created_at.desc&limit=100');
    state.requests=all;
    $('request-description').textContent=isAdmin?'요청된 별칭을 실제 상품과 대조해 승인하세요. 승인 즉시 공용 사전에 저장됩니다.':'등록한 승인 요청을 조회할 수 있습니다. 관리자가 승인한 뒤 공용 설정 새로고침을 누르세요.';
    $('requests-list').innerHTML=all.map((a,i)=>{
      const choices=state.products.map(p=>`<option value="${esc(p.id)}" ${p.id===a.suggested_product_id?'selected':''}>${esc(p.name)}</option>`).join('');
      return `<div class="unknown"><b>${esc(a.proposed_label)}</b> <span class="tag">${esc(a.status)}</span><div class="hint">${esc(new Date(a.created_at).toLocaleString('ko-KR'))}</div>${isAdmin&&a.status==='pending'?`<div class="tools"><select aria-label="승인할 상품">${choices}</select><button data-review="${i}" data-action="approve">승인</button><button class="secondary" data-review="${i}" data-action="reject">거절</button></div>`:''}</div>`;
    }).join('')||'<p>승인 요청이 없습니다.</p>';
  }
  async function review(requestIndex,action,productId){
    if(state.profile?.role!=='admin')throw Error('관리자만 승인할 수 있습니다.');
    const req=state.requests[requestIndex];if(!req)throw Error('요청을 찾을 수 없습니다.');
    await request('/rest/v1/rpc/review_inventory_alias',{method:'POST',body:{p_request_id:req.id,p_product_id:productId||null,p_approve:action==='approve'}});
    await Promise.all([loadCatalog(),loadRequests()]);
    message(`「${req.proposed_label}」 요청을 ${action==='approve'?'승인':'거절'}했습니다. 공용 설정이 업데이트됐습니다.`);
  }
  async function wrap(fn){try{await fn()}catch(e){message(e.message||String(e),true)}}
  $('config-form').addEventListener('submit',e=>{e.preventDefault();wrap(async()=>{
    const url=$('project-url').value.trim(),key=$('publishable-key').value.trim();
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url))throw Error('Supabase Project URL만 입력해 주세요.');
    if(!key||key.startsWith('sb_secret_')||key.startsWith('eyJ')&&key.length>200)throw Error('publishable/anon 키만 입력하세요. Secret/service_role 키는 금지됩니다.');
    state.config={url,key};localStorage.setItem(STORAGE_CONFIG,JSON.stringify(state.config));show('config-panel',false);show('login-panel',true);
    message('연결 정보가 저장됐습니다. 작업자 계정으로 로그인하세요.');
  })});
  $('login-form').addEventListener('submit',e=>{e.preventDefault();wrap(()=>login($('login-email').value.trim(),$('login-password').value))});
  $('analyze-btn').addEventListener('click',()=>wrap(async()=>{recalculate();message('공용 상품 사전으로 취합했습니다.')}));
  $('save-batch').addEventListener('click',()=>wrap(saveBatch));
  $('copy-qty').addEventListener('click',()=>wrap(async()=>{if(!state.result||state.result.hasErrors)throw Error('오류 행 해결 전에는 엑셀 복사가 차단됩니다.');await copy(state.products.map(p=>state.result.totals.get(p.name)).join('\n'));message('수량만 복사했습니다.')}));
  $('unknown-list').addEventListener('click',e=>{const btn=e.target.closest('button[data-request]');if(!btn)return;wrap(()=>{const group=state.unknowns[Number(btn.dataset.request)];return requestAlias(group,btn.parentElement.querySelector('select').value)})});
  $('requests-list').addEventListener('click',e=>{const btn=e.target.closest('button[data-review]');if(!btn)return;wrap(async()=>{const a=state.requests[Number(btn.dataset.review)];const sel=btn.parentElement.querySelector('select');if(!confirm(`「${a.proposed_label}」 별칭을 ${btn.dataset.action==='approve'?'승인':'거절'}하시겠습니까?`))return;await review(Number(btn.dataset.review),btn.dataset.action,sel?.value)})});
  $('reload-catalog').addEventListener('click',()=>wrap(async()=>{await loadCatalog();await loadRequests();message('공용 설정을 새로 불러왔습니다.')}));
  $('reload-requests').addEventListener('click',()=>wrap(loadRequests));
  $('load-history').addEventListener('click',()=>wrap(loadHistory));
  $('history-body').addEventListener('click',e=>{const btn=e.target.closest('button[data-history]');if(btn)showHistory(Number(btn.dataset.history))});
  $('history-copy').addEventListener('click',()=>wrap(async()=>{if(!state.historySelected||state.historySelected.error_count)throw Error('오류가 있는 이력은 수량 복사가 차단됩니다.');await copy(state.historySelected.result_snapshot.products.map(p=>p.quantity).join('\n'));message('과거 집계 수량을 복사했습니다.')}));
  $('logout-btn').addEventListener('click',()=>wrap(async()=>{try{await request('/auth/v1/logout',{method:'POST'});}finally{setSession(null);state.profile=null;state.result=null;show('workspace',false);show('login-panel',true);message('로그아웃했습니다.')}}));
  $('batch-date').value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  state.config=getConfig();state.session=getSession();
  if(!state.config){show('config-panel',true);message('먼저 Supabase 연결 정보를 입력하세요.')}else if(!state.session){show('login-panel',true);}else{wrap(openWorkspace)}
})();