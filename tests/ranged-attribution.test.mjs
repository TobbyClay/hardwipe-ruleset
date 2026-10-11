import assert from 'node:assert/strict';
import test from 'node:test';
import {collectRangedAdvisory,expectedMode,restoreManualRangedModes} from '../scripts/hardwipe-ranged.js';
const activity={attack:{type:{value:'ranged'}},actionType:'rwak'};
const workflow=attribution=>({activity,attackRollModifierTracker:{attribution}});
test('No evaluated Midi attribution means no reasons, regardless of actor data',()=>{
 for(const w of [{activity},workflow({})]) {Object.defineProperty(w,'actor',{get(){throw Error('Should never inspect actor flags or conditions')}});assert.deepEqual(collectRangedAdvisory(w).reasons,[]);}
});
test('Only evaluated ADV, DIS and suppression labels are copied',()=>{
 const w=workflow({ADV:{'attack.rwak':'Optical Targeting - Ranged attacks'},DIS:{range:'Long Range'},NOADV:{jammer:'Optics Jammer'},CRIT:{effect:'Critical'}});
 assert.deepEqual(collectRangedAdvisory(w).reasons,['Advantage: Optical Targeting - Ranged attacks','Disadvantage: Long Range','Advantage prevented: Optics Jammer']);
});
test('Sources keep their type for the readout, and the expected mode follows the cancel and block rules',()=>{
 const w=workflow({ADV:{a:'Optical Targeting - Advantage Attack (Ranged Weapon)'},DIS:{range:'Long Range'}});
 assert.deepEqual(collectRangedAdvisory(w).sources,[{type:'ADV',name:'Optical Targeting - Advantage Attack (Ranged Weapon)'},{type:'DIS',name:'Long Range'}]);
 const s=(...types)=>types.map(type=>({type,name:type}));
 assert.equal(expectedMode([]),0);assert.equal(expectedMode(s('ADV')),1);assert.equal(expectedMode(s('DIS')),-1);
 assert.equal(expectedMode(s('ADV','DIS')),0);assert.equal(expectedMode(s('ADV','DIS','NODIS')),1);assert.equal(expectedMode(s('ADV','NOADV')),0);
});
test('Manual buttons, options and keybindings never become source hints',()=>{
 const w=workflow({ADV:Object.fromEntries(['workflowOptions','options','keyPress','forcedKeyPress','config-buttons'].map(key=>[key,key]))});assert.deepEqual(collectRangedAdvisory(w).reasons,[]);
});
test('Missing labels and non-mode attribution cannot invent hints',()=>{
 assert.deepEqual(collectRangedAdvisory(workflow({ADV:{a:null,b:'',c:'  ',d:{}},FAIL:{a:'Automatic failure'}})).reasons,[]);
});
test('Thrown mode cannot borrow attribution evaluated as melee',()=>{
 const w=workflow({ADV:{mwak:'Melee effect'}});w.activity={...activity,actionType:'mwak',getActionType:mode=>mode==='thrown'?'rwak':'mwak'};assert.deepEqual(collectRangedAdvisory(w,'thrown').reasons,[]);
});
test('Explicit normal, advantage and disadvantage override native booleans without losing other options',()=>{
 for(const saved of [{},{advantage:true},{disadvantage:true},{advantage:false,disadvantage:false}]) {
  const config={subject:activity,hardwipeManualAttackModes:[saved],hardwipeManualAttackConfig:{},rolls:[{options:{advantage:true,disadvantage:true,isCritical:true,minimum:5}}]};restoreManualRangedModes(config);const opts=config.rolls[0].options;assert.equal(opts.advantage,saved.advantage);assert.equal(opts.disadvantage,saved.disadvantage);assert(opts.isCritical);assert.equal(opts.minimum,5);
 }
});
