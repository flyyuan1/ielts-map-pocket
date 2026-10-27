export function createAccountUI() {
  const opener = document.createElement('button'); opener.type = 'button'; opener.className = 'text-button account-opener'; opener.id = 'accountOpen'; opener.textContent = '登录同步';
  document.querySelector('.top-right').prepend(opener);
  const strip = document.createElement('div'); strip.className = 'account-strip'; strip.id = 'accountStrip';
  const status = document.createElement('span'); status.id = 'accountStatus'; status.textContent = '仅保存在本机'; status.setAttribute('role','status');
  const syncButton = document.createElement('button'); syncButton.type = 'button'; syncButton.textContent = '立即同步'; syncButton.id = 'accountSyncNow'; syncButton.hidden = true;
  strip.append(status,syncButton); document.querySelector('.top').after(strip);
  const dialog = document.createElement('dialog'); dialog.className = 'account-dialog'; dialog.id = 'accountDialog'; dialog.setAttribute('aria-labelledby','accountTitle');
  // Only fixed application markup is inserted. Account values are assigned through textContent.
  dialog.innerHTML = `<div class="account-dialog-top"><h2 id="accountTitle">登录同步</h2><button type="button" id="accountClose" aria-label="关闭账号窗口">×</button></div>
    <p class="account-intro" id="accountIntro">手机与电脑登录同一账号，共享学习进度。</p>
    <div id="accountSignedIn" hidden><p id="accountEmail"></p><button type="button" id="accountSignOut">退出本设备</button></div>
    <form id="accountForm"><label for="accountEmailInput">邮箱</label><input id="accountEmailInput" name="email" type="email" autocomplete="email" required maxlength="254">
    <div id="accountPasswordGroup"><label for="accountPasswordInput">密码</label><input id="accountPasswordInput" name="password" type="password" autocomplete="current-password" required maxlength="128"></div>
    <button class="account-primary" id="accountSubmit" type="submit">登录</button></form>
    <p class="account-message" id="accountMessage" role="status" aria-live="polite"></p>
    <div class="account-mode-buttons" id="accountModes"><button type="button" data-account-mode="signin">登录</button><button type="button" data-account-mode="signup">注册账号</button><button type="button" data-account-mode="recover">忘记密码</button></div>
    <section id="accountImportSection" hidden><h3>这台设备有已有进度</h3><p id="accountImportCount"></p><p>只合并已有标记，不会用空记录清空云端；相反标记暂保留为“不熟”。原始记录会备份。</p><div class="account-import-actions"><button type="button" id="accountImport">合并本机进度</button><button type="button" id="accountSkipImport">暂不合并</button></div></section>`;
  document.body.append(dialog);
  const field = id => dialog.querySelector('#'+id);
  let mode = 'signin', busy = false, handlers = {}, account = null;
  const showMessage = (message, isError=false) => { field('accountMessage').textContent=message;field('accountMessage').classList.toggle('is-error',isError); };
  function setMode(next) {
    mode=next; field('accountForm').hidden=false; field('accountSignedIn').hidden=true;
    field('accountEmailInput').closest('form').querySelector('label[for="accountEmailInput"]').hidden=next==='reset';
    field('accountEmailInput').hidden=next==='reset'; field('accountEmailInput').required=next!=='reset';
    field('accountPasswordGroup').hidden=next==='recover'; field('accountPasswordInput').required=next!=='recover';
    field('accountPasswordInput').minLength=next==='signin'?1:8;
    field('accountPasswordInput').autocomplete=next==='signin'?'current-password':'new-password';
    field('accountPasswordInput').value=''; field('accountModes').hidden=next==='reset';
    field('accountTitle').textContent={signin:'登录同步',signup:'注册学习账号',recover:'找回密码',reset:'设置新密码'}[next];
    field('accountSubmit').textContent={signin:'登录',signup:'注册并发送验证邮件',recover:'发送密码重置邮件',reset:'保存新密码'}[next];
    showMessage(next==='signup'?'当前用于个人学习，请使用已授权的项目成员邮箱注册。':'');
  }
  const close = () => { dialog.close(); field('accountPasswordInput').value=''; };
  field('accountClose').onclick=close;
  dialog.addEventListener('close',()=>{field('accountPasswordInput').value='';});
  opener.onclick=()=>{ if(account) { field('accountSignedIn').hidden=false;field('accountForm').hidden=true;field('accountModes').hidden=true;field('accountTitle').textContent='账号与同步';showMessage(''); }else setMode('signin'); dialog.showModal(); };
  dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)close();}});
  dialog.querySelectorAll('[data-account-mode]').forEach(button=>button.onclick=()=>{if(!busy)setMode(button.dataset.accountMode);});
  field('accountForm').addEventListener('submit',async event=>{
    event.preventDefault(); if(busy)return; const email=field('accountEmailInput').value.trim(); const password=field('accountPasswordInput').value;
    busy=true;field('accountSubmit').disabled=true;showMessage('正在处理…');
    try { await handlers.submit?.(mode,email,password); }
    finally { busy=false;field('accountSubmit').disabled=false;field('accountPasswordInput').value=''; }
  });
  field('accountSignOut').onclick=()=>handlers.signOut?.(); syncButton.onclick=()=>handlers.sync?.();
  field('accountImport').onclick=()=>handlers.import?.(); field('accountSkipImport').onclick=()=>handlers.skipImport?.();
  return {
    bind(value){handlers=value;}, showMessage,
    setUser(user) {
      account=user; opener.textContent=user?'账号与同步':'登录同步';syncButton.hidden=!user;
      field('accountEmail').textContent=user?.email??'';
      field('accountSignedIn').hidden=!user;field('accountForm').hidden=!!user;field('accountModes').hidden=!!user;
      if(!user)field('accountImportSection').hidden=true;
      if(dialog.open&&user){field('accountTitle').textContent='账号与同步';field('accountPasswordInput').value='';}
    },
    setStatus(state) {status.textContent=state.message;status.dataset.state=state.kind;syncButton.disabled=state.kind==='syncing';},
    showImport(count){field('accountImportSection').hidden=count===0;field('accountImportCount').textContent=`有 ${count} 张词卡的熟悉度标记可合并到当前账号。`;},
    showRecovery(){setMode('reset');if(!dialog.open)dialog.showModal();},
    close,
  };
}
