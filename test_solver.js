// 出番ソルバー検証（index.html と同一ロジックを移植してテスト）
// 実行: node test_solver.js
"use strict";

/* ---- パース ---- */
function normName(s){ return String(s).replace(/\s+/g,"").toUpperCase(); }
const DISPLAY=new Map();
function parseDuration(line){
  let m=line.match(/[\[(（]\s*(\d{1,2})\s*[:：]\s*(\d{1,2})\s*[\])）]\s*$/);
  if(m) return {sec:(+m[1])*60+(+m[2]), rest:line.slice(0,m.index).trim()};
  m=line.match(/[\[(（]\s*(\d{1,3})\s*分\s*[\])）]?\s*$/);
  if(m) return {sec:(+m[1])*60, rest:line.slice(0,m.index).trim()};
  return {sec:null, rest:line};
}
function parseActs(text){
  const acts=[], errors=[]; DISPLAY.clear();
  text.split(/\r?\n/).forEach(raw=>{
    let line=raw.trim(); if(!line) return;
    const {sec, rest}=parseDuration(line); line=rest;
    let name, body;
    const ci=line.search(/[:：]/);
    if(ci>=0){ name=line.slice(0,ci).trim(); body=line.slice(ci+1); }
    else if(line.includes("\t")){ const p=line.split("\t"); name=p[0].trim(); body=p.slice(1).join(" "); }
    else { name=line.trim(); body=""; }
    if(!name) return;
    const performers=new Set();
    body.split(/[、,，\t\s]+/).forEach(m=>{ const v=normName(m); if(v){ performers.add(v); if(!DISPLAY.has(v)) DISPLAY.set(v, m.trim()); } });
    acts.push({name, performers, dur:sec});
  });
  return {acts, errors};
}

/* ---- ソルバー ---- */
function appearanceCounts(acts){
  const cnt=new Map();
  for(const a of acts) for(const p of a.performers) cnt.set(p,(cnt.get(p)||0)+1);
  let maxC=0, who=null;
  for(const [p,c] of cnt){ if(c>maxC){ maxC=c; who=p; } }
  return {cnt, maxC, who};
}
function tryArrange(acts, gap, fixedAtPos, fixedIds, candidateOrder, attemptsMax){
  const n=acts.length;
  const order=new Array(n).fill(null);
  const used=new Array(n).fill(false);
  const lastPos=new Map();
  const attempts={count:0, max:attemptsMax};
  function canPlace(act, p){ for(const x of act.performers){ const lp=lastPos.get(x); if(lp!=null && p-lp<=gap) return false; } return true; }
  function place(act, p){ const prev=[]; for(const x of act.performers){ prev.push([x, lastPos.has(x)?lastPos.get(x):null]); lastPos.set(x,p); } order[p]=act; used[act.idx]=true; return prev; }
  function unplace(act, p, prev){ for(const [x,v] of prev){ if(v==null) lastPos.delete(x); else lastPos.set(x,v); } order[p]=null; used[act.idx]=false; }
  function dfs(p){
    if(attempts.count++ > attempts.max) return false;
    if(p===n) return true;
    if(fixedAtPos.has(p)){
      const act=fixedAtPos.get(p);
      if(!canPlace(act,p)) return false;
      const prev=place(act,p); if(dfs(p+1)) return true; unplace(act,p,prev); return false;
    }
    for(const act of candidateOrder){
      if(used[act.idx] || fixedIds.has(act.idx)) continue;
      if(!canPlace(act,p)) continue;
      const prev=place(act,p); if(dfs(p+1)) return true; unplace(act,p,prev);
    }
    return false;
  }
  return dfs(0)? order : null;
}
function solveLineup(acts, opts){
  opts=opts||{};
  acts.forEach((a,i)=> a.idx=i);
  const n=acts.length;
  if(n===0) return {error:"演目が読み取れませんでした。"};
  const byKey=new Map(); acts.forEach(a=> byKey.set(a.name.toUpperCase(), a));
  const fixedAtPos=new Map(); const fixedIds=new Set(); const posTaken=new Map();
  function pin(name, pos, labelForErr){
    const a=byKey.get(String(name).toUpperCase());
    if(!a) return `${labelForErr}に、入力にない演目名「${name}」があります。`;
    if(pos<0||pos>=n) return `「${name}」の位置（${pos+1}番）が演目数（${n}）の範囲外です。`;
    if(posTaken.has(pos) && posTaken.get(pos)!==a.idx) return `${pos+1}番に複数の演目が指定されています。`;
    posTaken.set(pos, a.idx); fixedAtPos.set(pos, a); fixedIds.add(a.idx);
    return null;
  }
  let e;
  if(opts.firstAct){ if(e=pin(opts.firstAct, 0, "オープニング指定")) return {error:e}; }
  if(opts.lastAct){ if(e=pin(opts.lastAct, n-1, "フィナーレ指定")) return {error:e}; }
  for(const r of (opts.fixRules||[])){ if(e=pin(r.act, r.pos-1, "固定指定")) return {error:e}; }

  const requested=Math.max(0, opts.gap==null?2:opts.gap);
  const {maxC, who}=appearanceCounts(acts);
  const gapCap = maxC<=1 ? requested : Math.max(0, Math.floor((n-1)/(maxC-1)) - 1);
  let gapStart = Math.min(requested, gapCap);
  const inOrder=acts.slice();
  const mrv=acts.slice().sort((a,b)=> b.performers.size - a.performers.size);

  let order=null, gapUsed=0;
  outer:
  for(let g=gapStart; g>=0; g--){
    for(const cand of [inOrder, mrv]){
      const r=tryArrange(acts, g, fixedAtPos, fixedIds, cand, 600000);
      if(r){ order=r; gapUsed=g; break outer; }
    }
  }
  if(!order){ order=acts.slice(); gapUsed=0; }
  const relaxed = gapUsed < requested;
  return { order, n, requested, gapUsed, relaxed,
    bottleneck: relaxed && maxC>1 ? {who:(DISPLAY.get(who)||who), count:maxC} : null,
    capReason: gapCap < requested };
}

/* ---- バリデータ ---- */
function validate(sol, acts, opts){
  const problems=[];
  const order=sol.order, n=acts.length;
  if(order.length!==n) problems.push(`並びの長さ ${order.length}≠${n}`);
  // 置換であること
  const seen=new Set();
  for(const a of order){ if(a==null){ problems.push('空きがある'); continue; } if(seen.has(a.idx)) problems.push(`演目「${a.name}」が重複`); seen.add(a.idx); }
  if(seen.size!==n) problems.push(`全演目が並んでいない（${seen.size}/${n}）`);
  // gapUsed の分離が満たされているか
  const pos=new Map();
  order.forEach((a,i)=> a && a.performers.forEach(x=>{ if(!pos.has(x)) pos.set(x,[]); pos.get(x).push(i); }));
  for(const [x,ps] of pos){ for(let i=1;i<ps.length;i++){ const between=ps[i]-ps[i-1]-1; if(between<sol.gapUsed) problems.push(`「${x}」の ${ps[i-1]+1}番→${ps[i]+1}番 が gapUsed(${sol.gapUsed}) 未満（間${between}組）`); } }
  // gapUsed<=requested
  if(sol.gapUsed>sol.requested) problems.push(`gapUsed(${sol.gapUsed})>requested(${sol.requested})`);
  // 固定の尊重
  const byKey=new Map(); order.forEach((a,i)=> a && byKey.set(a.name.toUpperCase(), i));
  if(opts.firstAct){ const i=byKey.get(opts.firstAct.toUpperCase()); if(i!==0) problems.push(`オープニング「${opts.firstAct}」が${i+1}番（1番でない）`); }
  if(opts.lastAct){ const i=byKey.get(opts.lastAct.toUpperCase()); if(i!==n-1) problems.push(`フィナーレ「${opts.lastAct}」が${i+1}番（最後でない）`); }
  for(const r of (opts.fixRules||[])){ const i=byKey.get(r.act.toUpperCase()); if(i!==r.pos-1) problems.push(`固定「${r.act}」が${i+1}番（${r.pos}番でない）`); }
  return problems;
}
function tightPerformers(sol){
  const order=sol.order; const pos=new Map();
  order.forEach((a,i)=> a && a.performers.forEach(x=>{ if(!pos.has(x)) pos.set(x,[]); pos.get(x).push(i); }));
  const tight=[];
  for(const [x,ps] of pos){ for(let i=1;i<ps.length;i++){ if(ps[i]-ps[i-1]-1 < sol.requested){ tight.push(x); break; } } }
  return tight;
}

/* ---- 実行ハーネス ---- */
let PASS=0, FAIL=0;
function show(sol){
  if(sol.error){ console.log(`    結果: ERROR -> ${sol.error}`); return; }
  console.log('    並び: '+sol.order.map((a,i)=>`${i+1}.${a.name}`).join('  '));
  console.log(`    gapUsed=${sol.gapUsed}/要求${sol.requested}${sol.relaxed?` (緩和: ${sol.bottleneck?sol.bottleneck.who+'×'+sol.bottleneck.count:''})`:''}`);
}
function run(label, text, opts, expect){
  expect=expect||{};
  console.log(`\n=== ${label} ===`);
  const {acts}=parseActs(text);
  const sol=solveLineup(acts, opts||{});
  show(sol);
  let ok=true, msg=[];
  if(expect.error){
    if(!sol.error){ ok=false; msg.push('エラーになるはずが解けた'); }
  } else {
    if(sol.error){ ok=false; msg.push('解けるはずがエラー: '+sol.error); }
    else {
      const probs=validate(sol, acts, opts||{});
      if(probs.length){ ok=false; msg.push(...probs); }
      if(expect.gapUsed!=null && sol.gapUsed!==expect.gapUsed){ ok=false; msg.push(`gapUsed=${sol.gapUsed}, 期待${expect.gapUsed}`); }
      if(expect.relaxed!=null && sol.relaxed!==expect.relaxed){ ok=false; msg.push(`relaxed=${sol.relaxed}, 期待${expect.relaxed}`); }
      if(expect.bottleneck && (!sol.bottleneck || normName(sol.bottleneck.who)!==normName(expect.bottleneck))){ ok=false; msg.push(`bottleneck=${sol.bottleneck&&sol.bottleneck.who}, 期待${expect.bottleneck}`); }
      if(expect.sameAsInput){ const same=sol.order.every((a,i)=>a.idx===i); if(!same){ ok=false; msg.push('入力順が保たれていない'); } }
      if(expect.tightAtLeast!=null){ const t=tightPerformers(sol).length; if(t<expect.tightAtLeast){ ok=false; msg.push(`早着替え注意 ${t}人 < 期待${expect.tightAtLeast}`); } }
    }
  }
  if(ok){ PASS++; console.log('    ✅ '+(expect.error?'期待通りエラー':'妥当')); }
  else { FAIL++; console.log('    ❌ '+msg.join(' / ')); }
}

/* ====================== テストケース ====================== */
const DEMO=`きらきら星: ひなた
メヌエット: そうま
となりのトトロ(連弾): ひなた りく
エリーゼのために: あおい
ねこふんじゃった: りく
トルコ行進曲: そうま
アンダー・ザ・シー(連弾): あおい ひなた
乙女の祈り: ゆい
カノン(連弾): りく そうま
情熱大陸: あおい`;

// 基本：掛け持ち4人×3演目、n=10、gap=2 は数え上げ可能 → 達成
run('基本デモ gap=2', DEMO, {gap:2}, {gapUsed:2, relaxed:false});
run('基本デモ gap=3（上限ぎりぎり）', DEMO, {gap:3}, {});

// 競合なし → 入力順そのまま・要求達成
run('競合なし gap=2', `A: a\nB: b\nC: c\nD: d\nE: e`, {gap:2}, {gapUsed:2, relaxed:false, sameAsInput:true});

// 自動緩和：1人が4演目に出演、n=5、gap=2要求 → gapCap=0
run('緩和：Xが4/5演目', `P1: X\nP2: X y\nP3: X z\nP4: X w\nP5: y z`, {gap:2}, {gapUsed:0, relaxed:true, bottleneck:'X', tightAtLeast:1});

// 中間的緩和：1人が3演目、n=7、gap=3要求 → gapCap=floor(6/2)-1=2
run('緩和：Xが3/7演目 gap=3', `P1: X\nP2: a\nP3: X b\nP4: c\nP5: X d\nP6: e\nP7: f`, {gap:3}, {gapUsed:2, relaxed:true, bottleneck:'X'});

// 固定：オープニング & フィナーレ
run('固定：最初=情熱大陸, 最後=きらきら星', DEMO, {gap:2, firstAct:'情熱大陸', lastAct:'きらきら星'}, {});
// 固定：特定位置
run('固定：カノン(連弾)を5番目に', DEMO, {gap:2, fixRules:[{act:'カノン(連弾)', pos:5}]}, {});
// 固定＋緩和の複合
run('固定3つ', DEMO, {gap:1, firstAct:'乙女の祈り', fixRules:[{act:'情熱大陸', pos:5},{act:'メヌエット', pos:8}]}, {});

// gap=0 は競合があっても必ず解ける
run('gap=0 で全員掛け持ち', `A: x y\nB: x y\nC: x y`, {gap:0}, {gapUsed:0, relaxed:false});

// 異常系
run('エラー：存在しない演目を固定', DEMO, {gap:2, firstAct:'存在しない曲'}, {error:true});
run('エラー：範囲外の位置', DEMO, {gap:2, fixRules:[{act:'きらきら星', pos:99}]}, {error:true});
run('エラー：同じ位置に2つ', DEMO, {gap:2, fixRules:[{act:'きらきら星', pos:3},{act:'メヌエット', pos:3}]}, {error:true});

// 所要時間パース
(function(){
  console.log('\n=== 所要時間パース ===');
  const {acts}=parseActs(`A: x [3:00]\nB: y (4分)\nC: z （2:30）\nD: w`);
  const got=acts.map(a=>a.dur);
  const exp=[180,240,150,null];
  const ok=JSON.stringify(got)===JSON.stringify(exp);
  console.log('    '+JSON.stringify(got));
  if(ok){ PASS++; console.log('    ✅ 妥当'); } else { FAIL++; console.log('    ❌ 期待 '+JSON.stringify(exp)); }
})();

// ストレス：30演目、一部が3演目に出演、gap=2
(function(){
  const lines=[];
  for(let i=0;i<30;i++){
    const ps=[`s${i}`]; // 固有
    if(i%5===0) ps.push(`hub${i%3}`); // 3人が広く掛け持ち
    lines.push(`曲${i}: ${ps.join(' ')}`);
  }
  run('ストレス 30演目 gap=2', lines.join('\n'), {gap:2}, {});
})();

// ランダム fuzz：分離制約とエラーなしを確認
(function fuzz(){
  console.log('\n=== fuzz 200ケース ===');
  let bad=0;
  for(let t=0;t<200;t++){
    const n=4+Math.floor(Math.random()*14);
    const pool=1+Math.floor(Math.random()*Math.max(2,n/2));
    const lines=[];
    for(let i=0;i<n;i++){
      const k=1+Math.floor(Math.random()*2);
      const ps=new Set(); for(let j=0;j<k;j++) ps.add('p'+Math.floor(Math.random()*pool));
      lines.push(`曲${i}: ${[...ps].join(' ')}`);
    }
    const gap=Math.floor(Math.random()*4);
    const {acts}=parseActs(lines.join('\n'));
    const sol=solveLineup(acts,{gap});
    if(sol.error){ bad++; continue; }
    const probs=validate(sol, acts, {});
    if(probs.length){ bad++; if(bad<=3) console.log('    ❌ '+probs.slice(0,2).join(' / ')); }
  }
  if(bad===0){ PASS++; console.log('    ✅ 200ケース 全て妥当（分離・置換・エラーなし）'); }
  else { FAIL++; console.log(`    ❌ ${bad}/200 で違反`); }
})();

console.log(`\n──────────\n結果: ${PASS} pass / ${FAIL} fail`);
process.exit(FAIL?1:0);
