(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded',function(){
    if(window.argCompatibilityBlocked||!window.argPersistence)return;
    const p=window.argPersistence, local=p.local, session=p.session;
    let stopped=false,ready=false,owner=false,acquiring=false,releaseLock=null,interval=null,panel=null;
    let lockRetryTimer=null,lockRetries=0;
    let revision=p.selected.data?.revision||0;
    let persistenceAllowed=!!navigator.locks;
    const bar=document.createElement('div');bar.id='arg-save-controls';
    bar.innerHTML='<span role="status" id="arg-save-status">自动存档已开启</span>';document.body.append(bar);
    const status=bar.querySelector('span');
    function route(){
      if(document.querySelector('#screen-start.arg-active,#screen-opening.arg-active'))return 'opening';
      if(document.querySelector('#screen-main.arg-active'))return 'diary';
      if(document.getElementById('arg-double').style.display==='block')return 'double';
      return 'desktop';
    }
    function showPanel(message,retry){
      if(!panel){panel=document.createElement('div');panel.id='arg-runtime-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.style.cssText='position:fixed;top:0;right:0;bottom:0;left:0;inset:0;z-index:2147483647;background:rgba(10,15,24,.94);color:#fff;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px;padding:32px;text-align:center;font:16px/1.7 Microsoft YaHei,sans-serif';document.body.append(panel);}
      while(panel.firstChild)panel.removeChild(panel.firstChild);const text=document.createElement('p');text.textContent=message;panel.appendChild(text);
      if(retry){const button=document.createElement('button');button.textContent='重试';button.style.cssText='padding:8px 30px;cursor:pointer';button.onclick=retry;panel.appendChild(button);}
      return panel;
    }
    function release(){owner=false;if(releaseLock){releaseLock();releaseLock=null;}}
    function stop(){stopped=true;ready=false;window.argRuntimeReady=false;window.argRestoringSave=true;try{window.argCountdownAudio?.stop();}catch(error){console.warn('Countdown audio stop failed:',error);}clearInterval(interval);clearTimeout(lockRetryTimer);release();}
    window.argStopSaving=stop;
    window.argShowResetFailure=retry=>showPanel('重新开始未完成，请重试。',retry||(()=>location.reload()));
    function stale(){return (local.getItem(p.GENERATION)||'initial')!==p.generation;}
    function save(manual){
      if(stopped||!ready||!owner||route()==='opening')return false;
      if(stale()){stop();showPanel('游戏已在其他标签页重新开始。请重新载入以继续。',()=>location.reload());return false;}
      try{
        const qq=window.argQQSave();
        if(!qq){if(manual)status.textContent='对话进行中，结束后自动保存';return false;}
        const storage={};Object.keys(session).filter(k=>argSaveNames.test(k)).forEach(k=>storage[k]=session.getItem(k));
        const rescue=JSON.parse(storage.arg_rescue_state_v1||'null');
        const data={version:2,generation:p.generation,revision:revision+1,savedAt:Date.now(),storage,qq,diary:argDiarySave(),route:route(),remaining:rescue&&!rescue.ending?Math.max(0,rescue.deadline-Date.now()):null};
        p.validate(data);
        if(!persistenceAllowed){status.textContent='浏览器存储不可用，本次进度仅在当前页面保留。';return false;}
        const raw=JSON.stringify(data),previous=local.getItem(p.KEY);
        if(previous){try{p.validate(JSON.parse(previous));local.setItem(p.BACKUP,previous);}catch(_){}}
        local.setItem(p.KEY,raw);local.setItem(p.MIGRATED,'1');revision=data.revision;
        status.textContent=window.argStorageUnavailable?'浏览器存储不可用，本次进度仅在当前页面保留。':'已保存 '+new Date(data.savedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
        return !window.argStorageUnavailable;
      }catch(e){status.textContent='保存失败：浏览器存储不可用或已满';console.error('Checkpoint rejected:',e);return false;}
    }
    window.argSaveProgress=save;
    function restore(){
      if(stopped)return;
      const latest=p.candidate();
      if(stale()||latest.raw!==p.selected.raw){release();location.reload();return;}
      if(p.selected.invalid&&!p.selected.data){
        const el=showPanel('未能读取存档，原存档已保留。可以重新开始游戏。');
        const button=document.createElement('button');button.textContent='重新开始';button.onclick=()=>window.argRestartGame();el.append(button);return;
      }
      try{
        const saved=p.selected.data;
        if(saved){
          window.argQQRestore(saved.qq);window.argDiaryRestore(saved.diary);
          if(saved.route==='diary')argToDiary();else if(saved.route==='double')argToDouble();else argToDesktop();
          status.textContent=p.selected.recovered?'已恢复最近有效的存档':'已恢复上次进度';
        }
        if(saved&&Number.isFinite(saved.remaining)){
          const rescue=JSON.parse(session.getItem('arg_rescue_state_v1')||'null');
          if(rescue&&!rescue.ending){rescue.deadline=Date.now()+saved.remaining;session.setItem('arg_rescue_state_v1',JSON.stringify(rescue));}
        }
        window.argRestoringSave=false;
        window.argDiaryResume?.();window.argRescueResume?.();window.argQQResumePending?.();
        // Derive a request only when the restored route is actually the computer desktop.
        if(route()==='desktop')window.onArgReturnDesktop?.();
        ready=true;window.argRuntimeReady=true;if(panel){panel.remove();panel=null;}
        bar.hidden=route()==='opening';
        interval=setInterval(()=>{bar.hidden=route()==='opening';save(false);},1500);
        save(false);
      }catch(e){
        ready=false;window.argRuntimeReady=false;window.argRestoringSave=true;
        window.argCountdownAudio?.stop();
        showPanel('进度恢复未完成，原存档已保留。请重新载入后重试。',()=>location.reload());
        console.error('Restore failed:',e);
      }
    }
    function acquire(){
      if(stopped||owner||acquiring)return;
      clearTimeout(lockRetryTimer);lockRetryTimer=null;
      acquiring=true;
      if(!navigator.locks){
        // No unsafe pseudo-lock: unsupported environments run without a shared persistent writer.
        acquiring=false;window.argStorageUnavailable=true;owner=true;
        restore();return;
      }
      Promise.resolve().then(()=>navigator.locks.request('elysium-game:active-writer',{mode:'exclusive',ifAvailable:true},async lock=>{
        acquiring=false;
        if(stopped)return;
        if(!lock){
          // A reloading document may briefly outlive its successor. Allow a
          // bounded handoff before treating the owner as another active tab.
          const retryDelays=[100,250,500];
          if(lockRetries<retryDelays.length){lockRetryTimer=setTimeout(acquire,retryDelays[lockRetries++]);return;}
          showPanel('游戏已在另一个标签页运行。关闭该标签页后，可在这里继续。',()=>{lockRetries=0;acquire();});return;
        }
        lockRetries=0;
        owner=true;
        const held=new Promise(resolve=>{releaseLock=resolve;});
        restore();await held;
      })).catch(e=>{
        acquiring=false;
        if(stopped)return;
        if(e.name==='SecurityError'||e.name==='NotSupportedError'){
          persistenceAllowed=false;window.argStorageUnavailable=true;owner=true;restore();return;
        }
        showPanel('暂时无法恢复游戏，请重新载入后重试。',()=>location.reload());console.error(e);
      });
    }
    window.addEventListener('storage',event=>{
      if(event.key===p.GENERATION&&stale()){stop();showPanel('游戏已在其他标签页重新开始。请重新载入以继续。',()=>location.reload());}
    });
    window.addEventListener('pagehide',()=>{save(false);stop();});
    window.addEventListener('pageshow',event=>{if(event.persisted){window.argRuntimeReady=false;location.reload();}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)save(false);});
    // Commit user actions after all synchronous story handlers have completed.
    document.addEventListener('click',()=>queueMicrotask(()=>save(false)));
    document.addEventListener('keyup',event=>{if(event.key==='Enter')queueMicrotask(()=>save(false));});
    acquire();
  });
})();
