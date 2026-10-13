/* Persistence is initialized before any game module reads its checkpoint. */
(function () {
  'use strict';
  const PREFIX = 'elysium-game:';
  const KEY = PREFIX + 'save:v2', BACKUP = PREFIX + 'save:backup:v2';
  const GENERATION = PREFIX + 'generation', MIGRATED = PREFIX + 'migrated:v2';
  const LEGACY = 'eclipse_save_v1';
  const names = /^(.*unlocked|mom_msg.*|friend_request.*|memo.*|lbb.*|shuidi.*|tieba.*|.*news.*|qzone_visited|qq2012_.*|qz_.*|arg_rescue_state_v1)$/;
  const branches = ['zhang', 'xu', 'lin'];
  window.argRestoringSave = true;
  window.argRuntimeReady = false;
  window.argStorageUnavailable = false;
  function storage(name) {
    const memory = new Map();
    let native = null;
    try { native = window[name]; const k=PREFIX+'probe'; native.setItem(k,'1');native.removeItem(k); }
    catch (_) { native=null; window.argStorageUnavailable = true; }
    let usable = !!native;
    function keys() {
      if(usable)try{return Array.from({length:native.length},(_,i)=>native.key(i)).filter(Boolean);}catch(_){usable=false;window.argStorageUnavailable=true;}
      return [...memory.keys()];
    }
    const api = {
      getItem(k) { k=String(k);if(usable)try{const v=native.getItem(k);if(v!==null)memory.set(k,v);return v;}catch(_){usable=false;window.argStorageUnavailable=true;}return memory.get(k)??null; },
      setItem(k,v) { k=String(k);v=String(v);memory.set(k,v);if(usable)try{native.setItem(k,v);}catch(_){usable=false;window.argStorageUnavailable=true;} },
      removeItem(k) { k=String(k);memory.delete(k);if(usable)try{native.removeItem(k);}catch(_){usable=false;window.argStorageUnavailable=true;} },
      key(i) { return keys()[i]??null; },
      clear() { keys().forEach(k=>api.removeItem(k)); }
    };
    return new Proxy({}, {
      get(_,k) { if(k==='length')return keys().length;if(k in api)return api[k];return api.getItem(k); },
      ownKeys:keys,
      getOwnPropertyDescriptor(_,k) { return keys().includes(k)?{enumerable:true,configurable:true}:undefined; }
    });
  }
  const local = window.argLocalStorage = storage('localStorage');
  const session = window.argSessionStorage = storage('sessionStorage');
  const object = x => !!x && typeof x==='object' && !Array.isArray(x);
  function validate(input) {
    if(!object(input)||![1,2].includes(input.version)||!object(input.storage)||!object(input.qq)||!object(input.diary))throw Error('Invalid checkpoint');
    const d=JSON.parse(JSON.stringify(input)),q=d.qq,diary=d.diary;
    if(!Number.isFinite(d.savedAt)||!['desktop','diary','double'].includes(d.route))throw Error('Invalid checkpoint metadata');
    if(!object(q.chat)||!object(q.chat.history)||!object(q.chat.drafts)||!object(q.unknownDone))throw Error('Invalid dialogue');
    for(const k of ['frPending','frDecided','unknownAdded','typingMode','momMsgSent','phase2Started','linkClicked','liReplied','momUnread'])if(typeof q[k]!=='boolean')throw Error('Invalid dialogue flag');
    if(![0,1,6,8,11,14,17,19,99].includes(q.dialoguePhase)||typeof q.typingSentence!=='string'||!Number.isInteger(q.typingIndex)||q.typingIndex<0)throw Error('Invalid dialogue position');
    if(q.dialoguePhase===99&&!q.momMsgSent||q.dialoguePhase===0&&q.phase2Started)throw Error('Incomplete dialogue checkpoint');
    if(!Array.isArray(q.badges)||!q.badges.every(x=>Array.isArray(x)&&typeof x[0]==='string'))throw Error('Invalid badges');
    for(const k of [...branches,'final'])if(typeof q.unknownDone[k]!=='boolean')throw Error('Invalid investigation');
    for(const messages of Object.values(q.chat.history))if(!Array.isArray(messages)||messages.some(m=>!object(m)||typeof m.text!=='string'))throw Error('Invalid messages');
    if(Object.values(q.chat.drafts).some(x=>typeof x!=='string'))throw Error('Invalid draft');
    if(!Array.isArray(diary.unlocks)||diary.unlocks.some(x=>![...branches,'final'].includes(x))||!Number.isInteger(diary.page)||diary.page<0||diary.page>13)throw Error('Invalid diary');
    if(!Object.entries(d.storage).every(([k,v])=>names.test(k)&&typeof v==='string'))throw Error('Invalid saved storage');
    if(d.storage.memo_todos){
      const todos=JSON.parse(d.storage.memo_todos);
      if(!Array.isArray(todos)||todos.some(t=>!object(t)||typeof t.text!=='string'||typeof t.done!=='boolean'||(t.locked!==undefined&&typeof t.locked!=='boolean')||(t.hints!==undefined&&(!Array.isArray(t.hints)||t.hints.some(h=>typeof h!=='string')))))throw Error('Invalid memos');
    }
    if(d.storage.memo_investigation_v1){
      const investigations=JSON.parse(d.storage.memo_investigation_v1);
      if(!object(investigations))throw Error('Invalid investigation storage');
      for(const key of branches){
        const x=investigations[key];if(x===undefined)continue;
        if(!object(x)||['active','done'].some(k=>x[k]!==undefined&&typeof x[k]!=='boolean')||['stage','next'].some(k=>x[k]!==undefined&&(!Number.isInteger(x[k])||x[k]<0||x[k]>(k==='stage'?3:4))))throw Error('Invalid investigation record');
      }
    }
    if(q.chat.qqid!==null&&typeof q.chat.qqid!=='string')throw Error('Invalid active chat');
    if(q.typingQQid!==null&&typeof q.typingQQid!=='string')throw Error('Invalid typing recipient');
    if(q.typingIndex>q.typingSentence.length)throw Error('Invalid typing index');
    if(q.typingMode&&!['u1001','u1002'].includes(q.typingQQid))throw Error('Invalid scripted recipient');
    if(q.unknownAdded&&!q.frDecided || q.frPending&&q.frDecided)throw Error('Conflicting request');
    if(q.unknownDone.final&&!branches.every(k=>q.unknownDone[k]))throw Error('Conflicting investigations');
    for(const k of [...branches,'final'])if(q.unknownDone[k]!==diary.unlocks.includes(k))throw Error('Conflicting diary unlock');
    if(q.unknownPending!==undefined){
      if(!Array.isArray(q.unknownPending)||q.unknownPending.some(j=>!object(j)||!Number.isSafeInteger(j.id)||j.id<1||typeof j.text!=='string'||!Number.isFinite(j.remaining)||j.remaining<0||typeof j.popup!=='boolean')||new Set(q.unknownPending.map(j=>j.id)).size!==q.unknownPending.length)throw Error('Invalid message queue');
    }
    const rawRescue=d.storage.arg_rescue_state_v1;
    if(rawRescue){
      const r=JSON.parse(rawRescue);
      if(!object(r)||!Number.isFinite(r.deadline)||![0,1,2,3].includes(r.ending))throw Error('Invalid rescue');
      if(r.ending===1){if(!q.frDecided||q.unknownAdded)throw Error('Conflicting refusal');}
      else if(!q.unknownAdded||!q.unknownDone.final||!diary.unlocks.includes('final'))throw Error('Premature rescue');
      if(!r.ending){
        const remaining=Number.isFinite(d.remaining)?d.remaining:r.deadline-d.savedAt;
        if(!Number.isFinite(remaining)||remaining<0||remaining>600000)throw Error('Invalid remaining time');
        d.remaining=remaining;
      }
    }
    if(d.version===2&&(!Number.isInteger(d.revision)||d.revision<1||typeof d.generation!=='string'))throw Error('Invalid revision');
    return d;
  }
  function clearSession(keepPassword) {
    Object.keys(session).filter(k=>names.test(k)&&(!keepPassword||k!=='qq2012_pass')).forEach(k=>session.removeItem(k));
  }
  function reset(keepPassword) {
    if(window.argStopSaving)window.argStopSaving();
    local.setItem(GENERATION,crypto.randomUUID());
    local.setItem(MIGRATED,'1');local.removeItem(KEY);local.removeItem(BACKUP);local.removeItem(LEGACY);
    clearSession(keepPassword);
    // Keep the original reset/password distinction, and clear only known legacy game keys.
    Object.keys(local).filter(k=>names.test(k)&&(!keepPassword||k!=='qq2012_pass')).forEach(k=>local.removeItem(k));
  }
  window.argRestartGame=function(){reset(false);location.reload();};
  window.argDiscardSave=function(){reset(false);};
  if(location.hash==='#qa-restart'||location.hash==='#reset'){
    const keep=location.hash==='#reset';
    history.replaceState(null,'',location.pathname+location.search);reset(keep);
  }
  const generation=local.getItem(GENERATION)||'initial';
  function candidate() {
    let invalid=false;
    const sources=[KEY,BACKUP];
    if(!local.getItem(MIGRATED)&&generation==='initial')sources.push(LEGACY);
    for(const key of sources){
      const raw=local.getItem(key);if(!raw)continue;
      try{
        const data=validate(JSON.parse(raw));
        if(data.version===2&&data.generation!==generation)continue;
        return {data,raw,key,recovered:key===BACKUP,invalid};
      }catch(_){invalid=true;}
    }
    return {data:null,raw:null,key:null,recovered:false,invalid};
  }
  const selected=candidate();
  window.argLoadedSave=selected.data;
  window.argSaveLoadFailed=selected.invalid;
  // Never leave a stale rescue/session behind after rejecting an aggregate snapshot.
  {
    clearSession(!selected.data&&!selected.invalid);
    if(selected.data){
      Object.entries(selected.data.storage).forEach(([k,v])=>session.setItem(k,v));
      const r=JSON.parse(session.getItem('arg_rescue_state_v1')||'null');
      if(r&&!r.ending){r.deadline=Date.now()+selected.data.remaining;session.setItem('arg_rescue_state_v1',JSON.stringify(r));}
    }
  }
  // Older loose local keys must not silently override the current session through gget().
  Object.keys(local).filter(k=>names.test(k)&&k!==KEY&&k!==BACKUP).forEach(k=>local.removeItem(k));
  window.argSaveKey=KEY;window.argSaveNames=names;
  window.argPersistence={KEY,BACKUP,GENERATION,MIGRATED,LEGACY,generation,selected,candidate,validate,local,session};
  // A partially restored document cannot accept actions, including keyboard shortcuts.
  for(const type of ['click','dblclick','keydown','keyup','pointerdown','mousedown']){
    document.addEventListener(type,function(e){
      if(window.argRuntimeReady||e.target.closest?.('#arg-runtime-panel'))return;
      e.preventDefault();e.stopImmediatePropagation();
    },true);
  }
})();
