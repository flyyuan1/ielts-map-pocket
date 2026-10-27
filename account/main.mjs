import config from './config.json';
import { createAccountAuth, authErrorText } from './auth.mjs';
import { createAccountUI } from './ui.mjs';
import { AccountStore, backupLegacy, readGuest } from './storage.mjs';
import { changedMarks, importLegacy, normalizeView } from './core.mjs';
import { ProgressSync } from './sync.mjs';

const bridge = window.pocketStudy;
const data = JSON.parse(document.getElementById('studyData').textContent);
const ids = new Set(data.cards.map(card=>card.id));
const categories = new Set(data.groups.map(group=>group.id));
const options = { ids, categories };
const ui = createAccountUI();
let auth, store = null, uid = null, applying = false, firstSnapshot = true;
let interacted = false, lastSeen = bridge.read(), importDismissed = false, pollTimer, changeTimer, lastState = {kind:'local',message:'仅保存在本机'};
const recovering = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';

function stopTimers(){clearTimeout(pollTimer);clearTimeout(changeTimer);}
function planPoll(){
  clearTimeout(pollTimer);
  if(!store||document.hidden||navigator.onLine===false||lastState.kind==='login')return;
  pollTimer=setTimeout(()=>sync.run(),lastState.kind==='error'?sync.retryDelay():lastState.kind==='pending'?400:15000);
}
function showImport(){
  if(!store||store.read().legacyImportComplete||importDismissed){ui.showImport(0);return;}
  try{ui.showImport(Object.keys(readGuest(localStorage,options).marks).length);}
  catch{ui.showMessage('本机旧进度暂不可读，原始记录未删除。',true);}
}
function applyProgress(snapshot,restoreView=false){
  applying=true;
  try{bridge.apply(snapshot,{restoreView});lastSeen=bridge.read();}
  finally{applying=false;}
}
const sync = new ProgressSync({
  api:{sync:(batch,accountId)=>auth.sync(batch,accountId)},
  onSnapshot(snapshot,accountId){
    if(!store||uid!==accountId)return;
    applyProgress({marks:snapshot.marks,...(snapshot.view??{})},firstSnapshot&&!interacted&&!!snapshot.view);
    firstSnapshot=false;
    if(snapshot.conflicts.length)bridge.notify('已合并两端的不同标记，暂优先保留为“不熟”。');
    showImport();
  },
  onState(state){lastState=state;ui.setStatus(state);if(state.kind!=='syncing')planPoll();},
});
async function sessionChanged(event,session){
  const nextUid=session?.user?.id??null;
  if(nextUid!==uid){
    stopTimers();sync.setAccount(null);store=null;uid=nextUid;firstSnapshot=true;importDismissed=false;
    window.pocketAccountActive=!!nextUid;
    if(nextUid){
      try{
        store=new AccountStore(localStorage,nextUid,options);
        sync.setAccount(store);
        applyProgress({marks:store.visibleMarks(),...(store.visibleView()??{})},!interacted&&!!store.visibleView());
      }catch(error){
        applyProgress({marks:{}});
        ui.setStatus({kind:'error',message:'本机账号缓存不可用，请先备份记录'});ui.showMessage(error.message,true);
      }
    }else{
      try{const guest=readGuest(localStorage,options);applyProgress({...guest,cat:guest.category},true);}
      catch{ui.showMessage('本机记录暂不可读，原始备份仍然保留。',true);}
      lastState={kind:'local',message:'仅保存在本机'};ui.setStatus(lastState);
    }
  }
  ui.setUser(session?.user??null);
  if(event==='PASSWORD_RECOVERY'||recovering&&event==='INITIAL_SESSION'&&session)ui.showRecovery();
  showImport();
  if(store)sync.run();
}
function recordProgress(event){
  if(applying)return;
  const next=event.detail;
  if(store){
    try{
      const changes=changedMarks(lastSeen.marks,next.marks);
      if(changes.length)store.enqueueMarks(changes);
      store.enqueueView(normalizeView(next,ids,categories));
      lastSeen=structuredClone(next);
      ui.setStatus({kind:navigator.onLine===false?'offline':'pending',message:navigator.onLine===false?'离线，联网后自动同步':'已存本机，等待同步'});
      clearTimeout(changeTimer);changeTimer=setTimeout(()=>sync.run(),400);
    }catch(error){ui.setStatus({kind:'error',message:'本机保存失败，请暂勿关闭页面'});ui.showMessage(error.message,true);}
  }else lastSeen=structuredClone(next);
}
document.addEventListener('pointerdown',event=>{if(event.target.closest('main')&&!document.querySelector('dialog[open]'))interacted=true;},true);
document.addEventListener('keydown',()=>{if(!document.querySelector('dialog[open]'))interacted=true;},true);
window.addEventListener('pocket:progress',recordProgress);
window.addEventListener('online',()=>sync.run());
window.addEventListener('offline',()=>{clearTimeout(pollTimer);if(store)ui.setStatus({kind:'offline',message:'离线，联网后自动同步'});});
window.addEventListener('focus',()=>{if(store&&!document.hidden)sync.run();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(pollTimer);else if(store)sync.run();});

ui.bind({
  async submit(mode,email,password){
    if(!auth){ui.showMessage('账号服务未能连接，本机学习仍可使用。请刷新重试。',true);return;}
    try{
      if(mode==='signin'){await auth.signIn(email,password);ui.showMessage('登录成功，正在合并云端记录。');}
      else if(mode==='signup'){await auth.signUp(email,password);ui.showMessage('验证邮件已发送，请打开邮件中的链接，确认邮箱后登录。');}
      else if(mode==='recover'){await auth.recover(email);ui.showMessage('如该邮箱已有账号，密码重置邮件将发往该邮箱。请检查收件箱与垃圾邮件。');}
      else if(mode==='reset'){await auth.updatePassword(password);ui.showMessage('新密码已保存。其他设备可以用新密码登录。');setTimeout(()=>ui.close(),1800);}
    }catch(error){ui.showMessage(authErrorText(error),true);}
  },
  async signOut(){
    if(!auth)return;
    try{await auth.signOut();await sessionChanged('SIGNED_OUT',null);ui.close();}
    catch(error){ui.showMessage(authErrorText(error),true);}
  },
  sync(){sync.run();},
  import(){
    if(!store)return;
    try{
      const guest=readGuest(localStorage,options);
      const merged=importLegacy(guest.marks,store.visibleMarks());
      store.enqueueMarks(changedMarks(store.visibleMarks(),merged));store.finishLegacyImport();
      applyProgress({marks:store.visibleMarks()});ui.showImport(0);ui.showMessage('本机旧进度已加入同步队列，原始备份已保留。');sync.run();
    }catch(error){ui.showMessage(error.message,true);}
  },
  skipImport(){importDismissed=true;ui.showImport(0);},
});
try{
  backupLegacy(localStorage);
  auth=createAccountAuth(config);
  auth.subscribe(sessionChanged);
  const session=await auth.session();
  await sessionChanged('INITIAL_SESSION',session);
  if(location.hash.includes('access_token=')||location.hash.includes('refresh_token=')||location.hash.includes('error_description='))history.replaceState(null,'',location.pathname+location.search);
}catch(error){ui.setStatus({kind:'error',message:'账号服务暂不可用，本机学习可继续'});ui.showMessage(authErrorText(error),true);}
