'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const element=()=>({listeners:{},addEventListener(event,cb){this.listeners[event]=cb},classList:{toggle(){}},setAttribute(){},querySelectorAll(){return []},style:{},value:'',hidden:false});
const nodes=new Map();
const saved=new Map();
const context={console,document:{getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)}},localStorage:{getItem(k){return saved.get(k)||null},setItem(k,v){saved.set(k,v)}},module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(__dirname+'/script.js','utf8'),context,{filename:'script.js'});
const {defaults,analyze}=context.module.exports;
function qty(raw,name){return analyze(raw,defaults()).totals.get(name)}
assert.equal(qty('인셀덤크림3개\n인셀덤크림2개','엑티브 크림'),5);
assert.equal(qty('인셀덤클린업파우더1개','엑티브 클린업 파우더'),1);
assert.equal(qty('인셀덤비비1개+인셀덤선젤2개','선젤'),2);
assert.equal(qty('인셀덤 래디언솜 3종1세트','래디언솜 앰플'),1);
assert.equal(qty('| 등록상품명 |\n| --- |\n| 인셀덤선젤2개 |','선젤'),2);
const r=analyze('인셀덤크림3개\n인셀덤비비1개+알수없는상품2개\n인셀덤카밍젤3개+화장품샘플',defaults());
assert.equal(r.hasErrors,true);
assert.equal(r.totals.get('비비'),0);
assert.equal(r.totals.get('엑티브 크림'),3);
assert.equal(r.totals.get('카밍젤'),3);
assert.equal(r.audit.filter(x=>x.status==='error').length,1);
assert.equal(r.gifts.length,1);
assert.equal(r.totals.size,24);
const dates=analyze('2026-11-12 인셀덤크림3개\n2026-11-13 인셀덤크림2개',defaults());
assert.equal(dates.dates.size,2);
assert.equal(dates.dates.get('2026-11-12').get('엑티브 크림'),3);
const {suggestedProducts,approveAlias}=context.module.exports;
const typo=analyze('인설덤비비2개',defaults());
assert.equal(typo.hasErrors,true);
assert.equal(typo.totals.get('비비'),0);
assert.equal(typo.audit[0].issues[0].unknownLabel,'인설덤비비');
assert.equal(suggestedProducts('인설덤비비',defaults().products)[0].name,'비비');
const variants=suggestedProducts('인셀덤 루미너스 쿠션 21호',defaults().products);
assert.ok(variants.find(x=>x.name==='루미너스 쿠션 21호').score>0.5);
assert.equal(variants.some(x=>x.name==='루미너스 쿠션 23호'),false);
assert.equal(qty('인셀덤 루미너스 쿠션 21호1개','루미너스 쿠션 23호'),0);
context.document.getElementById('orders').value='인설덤비비2개\n인설덤비비2개+인셀덤선젤1개';
nodes.get('analyze-btn').listeners.click();
assert.equal(nodes.get('error-count').textContent,2);
assert.equal(nodes.get('copy-btn').disabled,true);
approveAlias(0,'default-4');
assert.equal(nodes.get('error-count').textContent,0);
assert.equal(nodes.get('copy-btn').disabled,false);
assert.equal(nodes.get('total-count').textContent,'5');
assert.ok(saved.get('inventory-check-settings-v1').includes('인설덤비비'));
// Bundle decomposition: 3종/5종 are listing labels, not inferred component counts.
const three=analyze('인셀덤3종세트1세트',defaults());
assert.equal(three.hasErrors,false);
assert.equal(three.totals.get('퍼스트 패키지'),1);
assert.equal(three.totals.get('엑티브 크림'),1);
assert.equal(three.totals.get('오일미스트'),0);
assert.equal(three.totals.get('카밍젤'),0);
assert.equal(three.count,2);
const five=analyze('인셀덤5종세트2세트',defaults());
assert.equal(five.hasErrors,false);
assert.equal(five.totals.get('퍼스트 패키지'),2);
assert.equal(five.totals.get('엑티브 크림'),2);
assert.equal(five.totals.get('오일미스트'),2);
assert.equal(five.totals.get('카밍젤'),2);
assert.equal(five.count,8);
const both=analyze('인셀덤3종세트1개+인셀덤5종세트1세트',defaults());
assert.equal(both.hasErrors,false);
assert.equal(both.totals.get('퍼스트 패키지'),2);
assert.equal(both.totals.get('엑티브 크림'),2);
assert.equal(both.totals.get('오일미스트'),1);
assert.equal(both.totals.get('카밍젤'),1);
// Old locally stored settings must receive newly introduced sets without losing approved aliases.
const older=defaults();
older.sets=older.sets.slice(0,1);
older.products.find(p=>p.id==='default-4').aliases.push('인설덤비비');
saved.set('inventory-check-settings-v1',JSON.stringify(older));
const freshNodes=new Map();
const freshCtx={console,document:{getElementById(id){if(!freshNodes.has(id))freshNodes.set(id,element());return freshNodes.get(id)}},localStorage:{getItem(k){return saved.get(k)||null},setItem(k,v){saved.set(k,v)}},module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(__dirname+'/script.js','utf8'),freshCtx,{filename:'script.js'});
const migrated=JSON.parse(saved.get('inventory-check-settings-v1'));
assert.equal(migrated.sets.length,3);
assert.ok(migrated.products.find(p=>p.id==='default-4').aliases.includes('인설덤비비'));
assert.equal(freshCtx.module.exports.analyze('인셀덤5종세트1세트',migrated).count,4);
// Short set labels must survive removal of the trailing quantity token.
for (const [raw, first, cream, mist, gel] of [
  ['인셀덤3종1세트',1,1,0,0],
  ['인셀덤3종2개',2,2,0,0],
  ['인셀덤5종1세트',1,1,1,1],
  ['인셀덤5종세트1개',1,1,1,1]
]) {
  const value=analyze(raw,defaults());
  assert.equal(value.hasErrors,false,raw);
  for (const [name,expected] of [
    ['퍼스트 패키지',first],['엑티브 크림',cream],
    ['오일미스트',mist],['카밍젤',gel]
  ]) assert.equal(value.totals.get(name),expected,raw+' / '+name);
}
// '+' within a package label is not a bundle separator.
const cushions=analyze([
 '인셀덤  루미너스 모이스트 쿠션 23호(본품+리필) 1개',
 '인셀덤  루미너스 모이스트 쿠션 23호(본품+리필) 1개',
 '인셀덤  루미너스 모이스트 쿠션 21호(본품+리필) 1개 +화장품샘플'
].join('\n'),defaults());
assert.equal(cushions.hasErrors,false);
assert.equal(cushions.totals.get('루미너스 쿠션 23호'),2);
assert.equal(cushions.totals.get('루미너스 쿠션 21호'),1);
assert.equal(cushions.gifts.length,1);
const broken=analyze('인셀덤 루미너스 모이스트 쿠션 21호(본품+리필 1개',defaults());
assert.equal(broken.hasErrors,true);
assert.equal(broken.totals.get('루미너스 쿠션 21호'),0);
// Registered typo must expand to the three Radiansome inventory products.
for(const [raw,count] of [['인셀덤래디엄솜3종',1],['인셀덤래디엄솜3종1세트',1],['인셀덤래디엄솜3종세트2개',2]]){
  const result=analyze(raw,defaults());
  assert.equal(result.hasErrors,false,raw);
  for(const name of ['래디언솜 토너','래디언솜 앰플','래디언솜 크림']){
    assert.equal(result.totals.get(name),count,raw+' / '+name);
  }
  assert.equal(result.count,count*3);
}
// Registered set aliases may contain '+'; treat as a single bundle.
const comboSettings=defaults();
for(const [raw,expectedGel,expectedMist,expectedGifts] of [
 ['인셀덤 카밍밸런스젤 + 오일미스트 1세트',1,1,0],
 ['인셀덤 카밍밸런스젤 + 오일미스트 2세트',2,2,0],
 ['인셀덤 카밍밸런스젤 + 오일미스트 1세트+화장품샘플',1,1,1],
 ['인셀덤카밍젤3개+인셀덤오일미스트2개',3,2,0]
]){
  const result=analyze(raw,comboSettings);
  assert.equal(result.hasErrors,false,raw);
  assert.equal(result.totals.get('카밍젤'),expectedGel,raw);
  assert.equal(result.totals.get('오일미스트'),expectedMist,raw);
  assert.equal(result.gifts.length,expectedGifts,raw);
}
const seven=analyze(Array(7).fill('인셀덤 카밍밸런스젤 + 오일미스트 1세트').join('\n'),comboSettings);
assert.equal(seven.audit.length,7);
assert.equal(seven.totals.get('카밍젤'),7);
assert.equal(seven.totals.get('오일미스트'),7);
console.log('PASS: manual approval, bundle decomposition, localStorage migration, and inventory safety assertions');