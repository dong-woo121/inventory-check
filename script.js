'use strict';
(() => {
  const STORAGE_KEY = 'inventory-check-settings-v1';
  const names = ['클렌징오일','오일미스트','엑티브 크림','딥톡','비비','선젤','퍼스트 패키지','샴푸','컨디셔너','래디언솜 토너','래디언솜 앰플','라이프닝 리셋오메가','인셀덤 콜라겐','엑티브 에너지샷','래디언솜 크림','카밍젤','밸런싱 젤 클렌저','엑티브 클린업 파우더','보타랩 바디크림','메이크업 스프레이','루미너스 쿠션 21호','루미너스 쿠션 23호','바디워시','멀티밤'];
  const aliases = [
    '인셀덤클렌징오일,클오,인셀덤 클렌징오일','인셀덤오일미스트,오일 미스트,인셀덤 오일미스트',
    '인셀덤크림,인셀덤엑티브크림,엑티브크림,액티브크림,액티브 크림','인셀덤딥톡,딥톡스,인셀덤딥톡스',
    '인셀덤비비,인셀덤비비크림,비비크림,인셀덤 BB','인셀덤선젤,인셀덤 선젤,썬젤,인셀덤썬젤',
    '퍼스트,인셀덤퍼스트,인셀덤퍼스트패키지,퍼스트패키지',
    '인셀덤샴푸,보타랩샴푸,보타랩 샴푸','인셀덤컨디셔너,보타랩컨디셔너,보타랩 컨디셔너',
    '래디언솜토너,인셀덤래디언솜토너,래디언솜 토너','래디언솜앰플,인셀덤래디언솜앰플,래디언솜 앰플',
    '리셋오메가,라이프닝오메가,인셀덤오메가,오메가','콜라겐,라이프닝콜라겐,인셀덤콜라겐',
    '에너지샷,엑티브에너지샷,인셀덤에너지샷','래디언솜크림,인셀덤래디언솜크림,래디언솜 크림',
    '인셀덤카밍젤,카밍 젤,인셀덤 카밍젤','젤클렌저,젤클,밸런싱젤클렌저,인셀덤젤클렌저',
    '파우더워시,인셀덤파우더워시,인셀덤클린업파우더,클린업파우더,인셀덤엑티브클린업파우더,엑티브클린업파우더,엑티브클린업파우더워시',
    '바디크림,보타랩바디크림,보타랩바디크림릴랙싱,보타랩바디크림모닝',
    '메이크업세팅스프레이,인셀덤메이크업스프레이,인셀덤메이크업세팅스프레이,세팅스프레이',
    '쿠션21호,인셀덤쿠션21호,루미너스쿠션21호,21호쿠션','쿠션23호,인셀덤쿠션23호,루미너스쿠션23호,23호쿠션',
    '보타랩바디워시,보타랩 바디워시','인셀덤멀티밤,인셀덤 멀티밤'
  ];
  const defaults = () => ({
    products: names.map((name,i)=>({id:`default-${i}`,name,aliases:aliases[i].split(',')})),
    sets:[{aliases:['인셀덤 래디언솜 3종','래디언솜 3종','인셀덤래디언솜3종'],components:[{name:'래디언솜 토너',qty:1},{name:'래디언솜 앰플',qty:1},{name:'래디언솜 크림',qty:1}]}],
    gifts:['화장품샘플','화장품 샘플','사은품 마스크','마스크 사은품','무료 마스크','증정 마스크','마스크팩 사은품','사은품 마스크팩']
  });
  const $ = id => document.getElementById(id);
  const norm = s => String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\u200b\u00a0_·.()\[\]]+/g,'').trim();
  const splitAliases = s => [...new Set(String(s).split(/[,\n]/).map(x=>x.trim()).filter(Boolean))];
  const escapeHtml = s => String(s).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const clone = obj => JSON.parse(JSON.stringify(obj));
  let settings = loadSettings(), currentResult = null, editorProducts = [];

  function loadSettings(){
    try {const v=JSON.parse(localStorage.getItem(STORAGE_KEY)); if(v) {
      const powder=v.products?.find(p=>p.id==='default-17' && p.name==='엑티브 클린업 파우더');
      if(powder){
        const existing=new Set(powder.aliases.map(norm));
        for(const alias of ['인셀덤클린업파우더','클린업파우더']){
          if(!existing.has(norm(alias)))powder.aliases.push(alias);
        }
      }
      validateSettings(v);
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(v));}catch(e){console.warn('설정 자동 저장 실패:',e.message);}
      return v;
    }}
    catch(e){console.warn('저장된 설정을 불러오지 못하여 기본값을 사용합니다:',e.message);}
    return defaults();
  }
  function buildIndex(s){
    const productMap = new Map(), setMap = new Map(), giftMap = new Map(), known = new Map();
    function register(label, kind, val) {
      const key=norm(label);if(!key) throw Error('빈 별칭은 사용할 수 없습니다.');
      const old=known.get(key);
      if(old && (old.kind!==kind || old.id!==val.id)) throw Error(`별칭 충돌: "${label}" (${old.display} / ${val.display})`);
      known.set(key,{kind,id:val.id,display:val.display});
      ({product:productMap,set:setMap,gift:giftMap})[kind].set(key,val);
    }
    s.products.forEach(p=>{const item={id:p.id,display:p.name};[p.name,...p.aliases].forEach(a=>register(a,'product',item));});
    s.sets.forEach((set,i)=>set.aliases.forEach(a=>register(a,'set',{id:`set-${i}`,display:`세트: ${set.aliases[0]}`,set})));
    s.gifts.forEach(a=>register(a,'gift',{id:'gift',display:'사은품'}));
    return {productMap,setMap,giftMap};
  }
  function validateSettings(s){
    if(!s||!Array.isArray(s.products)||!Array.isArray(s.sets)||!Array.isArray(s.gifts)||!s.products.length)throw Error('상품을 하나 이상 등록해야 합니다.');
    const ids=new Set(), productNames=new Set();
    for(const p of s.products){if(!p.id||!p.name?.trim()||!Array.isArray(p.aliases))throw Error('상품의 이름 또는 별칭 형식이 올바르지 않습니다.');if(ids.has(p.id))throw Error('상품 ID가 중복되었습니다.');ids.add(p.id);if(productNames.has(p.name.trim()))throw Error(`중복된 상품명: ${p.name}`);productNames.add(p.name.trim());}
    for(const set of s.sets){if(!Array.isArray(set.aliases)||!set.aliases.length||!Array.isArray(set.components)||!set.components.length)throw Error('세트의 별칭이나 구성품이 비어 있습니다.');for(const c of set.components){if(!productNames.has(c.name)||!Number.isSafeInteger(c.qty)||c.qty<1)throw Error(`세트 구성품 또는 수량 확인: ${c.name}`);}}
    buildIndex(s);
  }
  function parseSource(raw){
    const rows=[];
    raw.split(/\r?\n/).forEach((original,idx)=>{
      const trimmed=original.trim();if(!trimmed)return;
      let content=trimmed, externalDate='';
      if(/^\|/.test(trimmed) && /\|/.test(trimmed.slice(1))){
        const cells=trimmed.replace(/^\|/,'').replace(/\|$/,'').split('|').map(v=>v.trim());
        if(cells.every(v=>/^:?-{3,}:?$/.test(v)))return;
        if(cells.some(v=>/^(등록상품명|상품명|주문상품명)$/i.test(v)))return;
        const values=cells.filter(Boolean);
        if(values.length===1)content=values[0];
        else {
          const d=values.find(v=>/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(v));
          if(d)externalDate=d;
          const nonDate=values.filter(v=>v!==d && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(v));
          content=nonDate[nonDate.length-1]||'';
        }
      }
      if(/^(등록상품명|상품명|주문상품명|주문 목록|주문목록|order items?|product name)$/i.test(content))return;
      const prefix=content.match(/^(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})(?:[ T]+\d{1,2}:\d{2}(?::\d{2})?)?\s*(?:[|,;:\-–]\s*|\s+)(.+)$/);
      if(prefix){externalDate=externalDate||prefix[1];content=prefix[2].trim();}
      if(!content)return;
      const isoDate=(externalDate.match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/)||[])[0];
      const date=isoDate?isoDate.replace(/[/.]/g,'-').split('-').map((part,i)=>i?part.padStart(2,'0'):part).join('-'):null;
      rows.push({line:idx+1,original,content,date});
    });
    return rows;
  }
  function parseItem(text,index){
    let item=text.trim().replace(/^[-•]\s*/,'').trim();
    if(!item)return {type:'error',reason:'빈 상품 항목'};
    const m=item.match(/^(.*?)(?:\s*[x×*]\s*(\d+)|\s*(\d+)\s*(개|세트|set|sets|팩|박스|병|통|매|ea|EA))\s*$/i);
    const label=m?m[1].trim():item;
    const qty=m?Number(m[2]||m[3]):null;
    if(m&&(!Number.isSafeInteger(qty)||qty<1))return {type:'error',reason:`수량이 올바르지 않습니다: ${item}`};
    const k=norm(label);
    if(index.giftMap.has(k))return {type:'gift',label:item,count:qty??1};
    if(index.productMap.has(k)){
      if(qty===null)return {type:'error',reason:`수량이 없습니다: ${item} (예: 1개)`};
      return {type:'product',name:index.productMap.get(k).display,count:qty,label:item};
    }
    if(index.setMap.has(k)){
      if(qty===null)return {type:'error',reason:`세트 수량이 없습니다: ${item} (예: 1세트)`};
      return {type:'set',components:index.setMap.get(k).set.components.map(c=>({name:c.name,count:c.qty*qty})),label:item};
    }
    return {type:'error',reason:`미등록 별칭: ${item}`};
  }
  function analyze(raw,s){
    validateSettings(s);
    const idx=buildIndex(s), rows=parseSource(raw), totals=new Map(s.products.map(p=>[p.name,0])), audit=[], gifts=[], productDetail=new Map(s.products.map(p=>[p.name,[]])),dates=new Map(),undatedRows=[];
    for(const row of rows){
      const parts=row.content.split(/\s*[+＋]\s*/);
      const interpreted=parts.map(p=>parseItem(p,idx)), errors=interpreted.filter(p=>p.type==='error');
      if(errors.length){audit.push({...row,status:'error',message:errors.map(p=>p.reason).join(' / ')});continue;}
      const contribution=new Map(), excluded=[];
      for(const item of interpreted){
        if(item.type==='gift'){excluded.push(`${item.label} (×${item.count})`);continue;}
        const additions=item.type==='product'?[{name:item.name,count:item.count}]:item.components;
        for(const v of additions)contribution.set(v.name,(contribution.get(v.name)||0)+v.count);
      }
      for(const [name,count] of contribution){
        const next=totals.get(name)+count;if(!Number.isSafeInteger(next))throw Error(`합산 수량이 안전한 정수 범위를 초과했습니다: ${name}`);
        totals.set(name,next);productDetail.get(name).push(`원본 ${row.line}행 +${count}개 (${row.content})`);
      }
      if(!row.date)undatedRows.push(row.line);
      if(row.date){if(!dates.has(row.date))dates.set(row.date,new Map(s.products.map(p=>[p.name,0])));const dt=dates.get(row.date);for(const [name,count] of contribution)dt.set(name,dt.get(name)+count);}
      excluded.forEach(x=>gifts.push({line:row.line,description:x}));
      audit.push({...row,status:contribution.size?'ok':'gift',message:[...contribution].map(([n,v])=>`${n} +${v}`).concat(excluded.map(x=>`사은품 제외: ${x}`)).join(' / ')});
    }
    return {totals,audit,gifts,productDetail,dates,undatedRows,hasErrors:audit.some(a=>a.status==='error'),count: [...totals.values()].reduce((a,b)=>a+b,0)};
  }
  function showResult(r){
    currentResult=r;$('result-panel').hidden=false;
    const err=r.audit.filter(a=>a.status==='error'), valid=r.audit.length-err.length;
    $('total-count').textContent=r.count.toLocaleString('ko-KR');$('row-count').textContent=r.audit.length;
    $('valid-count').textContent=valid;$('error-count').textContent=err.length;
    $('result-status').textContent=err.length?'검증 필요':'검증 완료';$('result-status').classList.toggle('bad',!!err.length);
    $('warning').hidden=!err.length;
    $('warning').textContent=err.length?`⚠ ${err.length}개 주문 행에 미인식 항목 또는 오류가 있습니다. 원본 행 번호: ${err.map(x=>x.line).join(', ')}. 해당 행은 합산하지 않았으며 오류 해결 전 엑셀 복사가 차단됩니다.`:'';
    $('summary-body').innerHTML=settings.products.map((p,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(p.name)}</td><td class="num">${r.totals.get(p.name)}</td></tr>`).join('');
    $('copy-preview').value=settings.products.map(p=>r.totals.get(p.name)).join('\n');
    $('copy-btn').disabled=r.hasErrors;$('copy-dates-btn').disabled=r.hasErrors||!r.dates.size||!!r.undatedRows.length;
    $('audit-title').textContent=`(${r.audit.length}행)`;
    $('audit-body').innerHTML=r.audit.map(a=>`<tr><td>${a.line}</td><td class="row-${a.status}">${a.status==='ok'?'정상 집계':a.status==='gift'?'사은품 제외':'오류 / 미인식'}</td><td><span class="source">${escapeHtml(a.original)}</span>${escapeHtml(a.message)}</td></tr>`).join('')||'<tr><td colspan="3">주문을 입력해 주세요.</td></tr>';
    $('product-details').innerHTML=settings.products.map(p=>`<p><b>${escapeHtml(p.name)} (${r.totals.get(p.name)}개)</b><br>${(r.productDetail.get(p.name)||[]).map(escapeHtml).join('<br>')||'집계된 주문 없음'}</p>`).join('');
    $('gift-count').textContent=`(${r.gifts.length}건)`;
    $('gift-list').innerHTML=r.gifts.map(g=>`<li>원본 ${g.line}행: ${escapeHtml(g.description)}</li>`).join('')||'<li>제외된 사은품 없음</li>';
    const dates=[...r.dates.keys()].sort();
    $('dates-preview').value=dates.length?['상품명\t'+dates.join('\t'),...settings.products.map(p=>`${p.name}\t${dates.map(d=>r.dates.get(d).get(p.name)).join('\t')}`)].join('\n'):'';
    $('copy-message').textContent=err.length?'오류 행을 해결하면 복사할 수 있습니다.':'';
    $('dates-preview').title=r.undatedRows.length?`날짜 없는 주문 행: ${r.undatedRows.join(', ')}. 날짜별 복사가 차단됩니다.`:'';
  }
  async function copyText(text){
    if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(text);return true;}catch(e){}}
    const node=document.createElement('textarea');node.value=text;node.setAttribute('readonly','');node.style.cssText='position:fixed;left:-9999px;top:0';document.body.appendChild(node);node.select();let success=false;
    try{success=document.execCommand('copy');}finally{node.remove();}return success;
  }
  function renderEditor(){
    $('settings-body').innerHTML=editorProducts.map((p,i)=>`<tr data-id="${escapeHtml(p.id)}"><td>${i+1}</td><td><input class="product-name" aria-label="${i+1}번 상품명" value="${escapeHtml(p.name)}"></td><td><textarea class="product-alias" aria-label="${i+1}번 상품 별칭">${escapeHtml(p.aliases.join(', '))}</textarea></td><td><button class="ghost tiny" data-move="up" title="위로" ${i===0?'disabled':''}>↑</button><button class="ghost tiny" data-move="down" title="아래로" ${i===editorProducts.length-1?'disabled':''}>↓</button><button class="danger tiny" data-move="delete" title="삭제">삭제</button></td></tr>`).join('');
  }
  function syncEditor(){
    $('settings-body').querySelectorAll('tr').forEach((row,i)=>{editorProducts[i].name=row.querySelector('.product-name').value.trim();editorProducts[i].aliases=splitAliases(row.querySelector('.product-alias').value);});
  }
  function renderConfig(){
    editorProducts=clone(settings.products);renderEditor();
    $('set-config').value=settings.sets.map(s=>`${s.aliases.join(' / ')} | ${s.components.map(c=>`${c.name}:${c.qty}`).join(', ')}`).join('\n');
    $('gift-config').value=settings.gifts.join(', ');
  }
  function parseConfig(){
    syncEditor();
    const sets=$('set-config').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,i)=>{
      const seg=line.split('|');if(seg.length!==2)throw Error(`세트 규칙 ${i+1}행에 | 기호가 필요합니다.`);
      const setAliases=seg[0].split('/').map(x=>x.trim()).filter(Boolean);
      const components=seg[1].split(',').map(part=>{
        const m=part.trim().match(/^(.+?):\s*(\d+)$/);if(!m)throw Error(`세트 규칙 ${i+1}행 구성 형식 오류: ${part}`);
        return {name:m[1].trim(),qty:Number(m[2])};
      });return {aliases:setAliases,components};
    });
    return {products:clone(editorProducts),sets,gifts:splitAliases($('gift-config').value)};
  }
  function msg(text,isError=false){$('settings-message').textContent=text;$('settings-message').className=isError?'error-message small':'success-message small';}
  $('analyze-btn').addEventListener('click',()=>{try{const r=analyze($('orders').value,settings);showResult(r);}catch(e){alert(`집계 오류: ${e.message}`);}});
  $('sample-btn').addEventListener('click',()=>{$('orders').value=['인셀덤크림3개','인셀덤크림2개','인셀덤선젤2개','인셀덤비비1개+인셀덤선젤1개','인셀덤카밍젤3개+화장품샘플','인셀덤 래디언솜 3종1세트'].join('\n');});
  $('clear-btn').addEventListener('click',()=>{$('orders').value='';$('result-panel').hidden=true;currentResult=null;});
  $('copy-btn').addEventListener('click',async()=>{if(!currentResult||currentResult.hasErrors)return;const success=await copyText($('copy-preview').value);$('copy-message').textContent=success?`${settings.products.length}개 상품 순서대로 수량을 복사했습니다.`:'자동 복사가 제한되었습니다. 미리보기에서 직접 선택하여 복사해 주세요.';});
  $('copy-dates-btn').addEventListener('click',async()=>{if(!currentResult||currentResult.hasErrors||!currentResult.dates.size||currentResult.undatedRows.length)return;const success=await copyText($('dates-preview').value);alert(success?'날짜별 TSV를 복사했습니다.':'복사가 제한되었습니다. 아래 텍스트를 선택하여 복사해 주세요.');});
  $('settings-toggle').addEventListener('click',()=>{const show=$('settings-content').hidden;$('settings-content').hidden=!show;$('settings-toggle').textContent=show?'설정 닫기':'설정 열기';$('settings-toggle').setAttribute('aria-expanded',String(show));if(show)renderConfig();});
  $('settings-body').addEventListener('click',e=>{
    const btn=e.target.closest('button[data-move]');if(!btn)return;
    syncEditor();const row=btn.closest('tr'),idx=[...row.parentElement.children].indexOf(row),action=btn.dataset.move;
    if(action==='delete'){if(editorProducts.length<=1){msg('상품은 최소 하나가 필요합니다.',true);return;}if(!confirm(`"${editorProducts[idx].name}" 상품을 삭제하시겠습니까?`))return;editorProducts.splice(idx,1);}
    else {const target=idx+(action==='up'?-1:1);if(target<0||target>=editorProducts.length)return;[editorProducts[idx],editorProducts[target]]=[editorProducts[target],editorProducts[idx]];}
    renderEditor();
  });
  $('add-product').addEventListener('click',()=>{syncEditor();editorProducts.push({id:`custom-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name:'새 상품',aliases:[]});renderEditor();$('settings-body').lastElementChild.querySelector('input').focus();});
  $('save-settings').addEventListener('click',()=>{try{const next=parseConfig();validateSettings(next);localStorage.setItem(STORAGE_KEY,JSON.stringify(next));settings=next;currentResult=null;$('result-panel').hidden=true;msg('설정을 저장했습니다. 주문 데이터를 다시 취합해 주세요.');}catch(e){msg(`저장하지 않았습니다: ${e.message}`,true);}});
  $('export-settings').addEventListener('click',()=>{
    try {
      const blob=new Blob([JSON.stringify({format:'inventory-check-settings',version:1,settings},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='재고확인-설정백업.json';document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);msg('현재 적용된 설정을 백업했습니다.');
    } catch(e){msg(`설정 백업 실패: ${e.message}`,true);}
  });
  $('import-settings').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(file.size>2*1024*1024)throw Error('2MB 이하의 JSON 설정 파일만 가져올 수 있습니다.');
      const data=JSON.parse(await file.text());
      if(data.format!=='inventory-check-settings'||data.version!==1)throw Error('재고확인에서 내보낸 설정 백업 파일이 아닙니다.');
      validateSettings(data.settings);
      if(!confirm('현재 저장된 상품·별칭·세트·엑셀 순서를 백업 파일 내용으로 교체하시겠습니까?'))return;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(data.settings));settings=clone(data.settings);renderConfig();
      currentResult=null;$('result-panel').hidden=true;msg('설정을 가져왔습니다. 주문 데이터를 다시 취합해 주세요.');
    }catch(err){msg(`설정 가져오기 실패: ${err.message}`,true);}
    finally{e.target.value='';}
  });
  $('reset-settings').addEventListener('click',()=>{if(!confirm('등록 상품·별칭·세트를 모두 기본값으로 되돌리시겠습니까?'))return;const next=defaults();try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));settings=next;renderConfig();$('result-panel').hidden=true;currentResult=null;msg('기본값으로 복원했습니다.');}catch(e){msg(`복원 실패: ${e.message}`,true);}});
  if(typeof module!=='undefined'&&module.exports)module.exports={defaults,analyze,parseSource,parseItem,buildIndex,validateSettings};
})();
