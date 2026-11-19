'use strict';
/* Extracted from the verified v1.4.1 parser; no DOM, storage or external dependencies. */
(function(root){
const norm = s => String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\u200b\u00a0_·.()\[\]]+/g,'').trim();
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
  // Markdown table cells are handled separately to prevent pipe delimiters becoming product text.
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
      // Strip a date or timestamp only when it appears at the start of a row.
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
    // Parse a complete suffix, never determine products by substring match.
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
    return {type:'error',reason:`미등록 별칭: ${item}`,unknownLabel:label};
  }
  function analyze(raw,s){
    validateSettings(s);
    const idx=buildIndex(s), rows=parseSource(raw), totals=new Map(s.products.map(p=>[p.name,0])), audit=[], gifts=[], productDetail=new Map(s.products.map(p=>[p.name,[]])),dates=new Map(),undatedRows=[];
    for(const row of rows){
      const parts=row.content.split(/\s*[+＋]\s*/); // each item must be recognized; any error rejects the entire row
      const interpreted=parts.map(p=>parseItem(p,idx)), errors=interpreted.filter(p=>p.type==='error');
      if(errors.length){audit.push({...row,status:'error',issues:errors.map(p=>({reason:p.reason,unknownLabel:p.unknownLabel||null})),message:errors.map(p=>p.reason).join(' / ')});continue;}
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
  // Similarity is only a suggestion. No fuzzy match is ever counted as an order.
  function levenshtein(a,b){
    if(a===b)return 0;
    let previous=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){
      const current=[i];
      for(let j=1;j<=b.length;j++)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
      previous=current;
    }
    return previous[b.length];
  }
  function variantNumbers(label){
    return [...norm(label).matchAll(/(\d{1,3})호/g)].map(m=>m[1]);
  }
  function suggestionScore(label,alias){
    const a=norm(label),b=norm(alias);
    if(!a||!b)return 0;
    const left=variantNumbers(label),right=variantNumbers(alias);
    if(left.length&&right.length&&left.join(',')!==right.join(','))return -1;
    // An alias without a shade cannot override a shade-specific product identity.
    if(left.length&&(/쿠션/.test(a))&&!right.length&&/쿠션/.test(b))return 0;
    return 1-levenshtein(a,b)/Math.max(a.length,b.length);
  }
  function suggestedProducts(label,products){
    return products.map(p=>({id:p.id,name:p.name,score:Math.max(...[p.name,...p.aliases].map(a=>suggestionScore(label,a)))}))
      .filter(p=>p.score>=0).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ko'));
  }
  
const api={norm,buildIndex,validateSettings,parseSource,parseItem,analyze,suggestedProducts};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(root)root.InventoryCore=api;
})(typeof window!=='undefined'?window:null);
