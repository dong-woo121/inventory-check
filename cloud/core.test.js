'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const core=require('./core.js');
const settings={
 products:[
  {id:'default-4',name:'비비',aliases:['인셀덤비비']},
  {id:'default-6',name:'퍼스트 패키지',aliases:['퍼스트패키지']},
  {id:'default-2',name:'엑티브 크림',aliases:['인셀덤크림','더마톨로지크림']},
  {id:'default-1',name:'오일미스트',aliases:['인셀덤오일미스트']},
  {id:'default-15',name:'카밍젤',aliases:['인셀덤카밍젤']},
  {id:'default-20',name:'루미너스 쿠션 21호',aliases:['인셀덤 루미너스 모이스트 쿠션 21호']},
  {id:'default-21',name:'루미너스 쿠션 23호',aliases:['인셀덤 루미너스 모이스트 쿠션 23호']}
 ],
 sets:[
  {aliases:['인셀덤3종','인셀덤3종세트'],components:[{name:'퍼스트 패키지',qty:1},{name:'엑티브 크림',qty:1}]},
  {aliases:['인셀덤5종','인셀덤5종세트'],components:[{name:'퍼스트 패키지',qty:1},{name:'엑티브 크림',qty:1},{name:'오일미스트',qty:1},{name:'카밍젤',qty:1}]}
 ],
 gifts:['화장품샘플','물티슈']
};
test('기본 별칭, 묶음, 사은품 모두 합산',()=>{
 const r=core.analyze('인셀덤3종1세트\n인셀덤5종2세트\n인셀덤카밍젤3개+물티슈',settings);
 assert.equal(r.count,2+8+3);
 assert.equal(r.totals.get('퍼스트 패키지'),3);
 assert.equal(r.totals.get('엑티브 크림'),3);
 assert.equal(r.totals.get('오일미스트'),2);
 assert.equal(r.totals.get('카밍젤'),5);
 assert.equal(r.gifts.length,1);
 assert.equal(r.hasErrors,false);
});
test('유사도 추천은 승인 없이 집계되지 않음',()=>{
 const r=core.analyze('인설덤비비2개',settings);
 assert.equal(r.count,0);
 assert.equal(r.hasErrors,true);
 assert.equal(r.audit[0].issues[0].unknownLabel,'인설덤비비');
 assert.equal(core.suggestedProducts('인설덤비비',settings.products)[0].name,'비비');
});
test('미인식 하나가 혼합 주문 행 전체를 보류',()=>{
 const r=core.analyze('인설덤비비2개+인셀덤카밍젤3개',settings);
 assert.equal(r.count,0);assert.equal(r.audit[0].status,'error');
});
test('수동 승인된 별칭만 이후 주문에 반영',()=>{
 const copy=JSON.parse(JSON.stringify(settings));
 copy.products.find(p=>p.name==='비비').aliases.push('인설덤비비');
 const r=core.analyze('인설덤비비2개+인셀덤카밍젤3개',copy);
 assert.equal(r.count,5);assert.equal(r.hasErrors,false);
});
test('쿠션 21호 및 23호 수량 붙여쓰기를 구별',()=>{
 const r=core.analyze('인셀덤 루미너스 모이스트 쿠션 21호1개\n인셀덤 루미너스 모이스트 쿠션 23호2개',settings);
 assert.equal(r.totals.get('루미너스 쿠션 21호'),1);
 assert.equal(r.totals.get('루미너스 쿠션 23호'),2);
 assert.equal(r.hasErrors,false);
});
test('쿠션 호수 미상은 승인 없이 보류',()=>{
 const r=core.analyze('인셀덤 루미너스 모이스트 쿠션1개',settings);
 assert.equal(r.count,0);assert.equal(r.hasErrors,true);
});
test('동일 단어 별칭이 두 상품에 연결되면 검증 에러',()=>{
 const copy=JSON.parse(JSON.stringify(settings));
 copy.products.find(p=>p.name==='비비').aliases.push('인셀덤카밍젤');
 assert.throws(()=>core.validateSettings(copy),/별칭 충돌/);
});
