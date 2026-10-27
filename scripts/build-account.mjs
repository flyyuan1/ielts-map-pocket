import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const at=path=>resolve(root,path);
await mkdir(at('source'),{recursive:true});await mkdir(at('assets'),{recursive:true});
try{await access(at('source/lesson.html'));}
catch{
  const original=await readFile(at('index.html'),'utf8');
  if(original.includes('pocket:progress'))throw new Error('Missing original lesson source; refusing to patch an already built page');
  await writeFile(at('source/lesson.html'),original);
}
let html=await readFile(at('source/lesson.html'),'utf8');
const originalData=html.match(/<script[^>]*id="studyData"[^>]*>([\s\S]*?)<\/script>/)?.[1];
if(!originalData||JSON.parse(originalData).cards.length!==132)throw new Error('Lesson data is incomplete');
const replace=(pattern,value)=>{
  if(!pattern.test(html))throw new Error('Lesson patch target was not found: '+String(pattern));
  html=html.replace(pattern,()=>value);
};
replace(/^function persist\(\).*$/m,`function persist(){
  try{if(window.pocketBackupError)throw new Error('Backup unavailable');if(!window.pocketAccountActive)localStorage.setItem(KEY,JSON.stringify({marks,filter,cat,position:index}));}
  catch(e){storageOK=false;}
  $('storageNote').textContent=storageOK?(window.pocketAccountActive?'本机缓存并同步到当前账号 · 朗读取决于设备':'进度保存在当前浏览器 · 朗读优先使用设备英音'):'当前浏览器无法保存进度 · 本次仍可正常背诵';
  window.dispatchEvent(new CustomEvent('pocket:progress',{detail:{marks:{...marks},filter,category:cat,cardId:deck[index]?.id??null,position:index}}));
}`);
replace(/^function offlineDownload\(\).*$/m,`function offlineDownload(){const bytes=Uint8Array.from(atob(document.getElementById('pocketOfflineSource').textContent.trim()),c=>c.charCodeAt(0));download(bytes,'text/html;charset=utf-8','雅思地图题口袋卡-离线版.html');toast('已开始下载独立离线版；不会包含账号信息。');}`);
replace(/if\(!confirm\('重置本浏览器的熟悉度和位置？词卡内容会保留。'\)\)/,`if(!confirm(window.pocketAccountActive?'重置此账号的熟悉度和位置？这项更改会同步到其他设备。词卡内容会保留。':'重置本浏览器的熟悉度和位置？词卡内容会保留。'))`);
replace(/document\.addEventListener\('keydown',e=>\{/,`document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]'))return;`);
const bridge=`
window.pocketStudy=Object.freeze({
  read(){return {marks:{...marks},filter,category:cat,cardId:deck[index]?.id??null,position:index};},
  notify:toast,
  apply(snapshot,{restoreView=false}={}){
    const currentId=deck[index]?.id,oldOrder=new Map(deck.map((card,i)=>[card.id,i])),wasRevealed=revealed;
    marks={};for(const card of DATA.cards){const value=snapshot.marks?.[card.id];if(value==='known'||value==='weak')marks[card.id]=value;}
    if(restoreView){if(['core','all','weak','new'].includes(snapshot.filter))filter=snapshot.filter;const desiredCat=snapshot.category??snapshot.cat;if(desiredCat==='all'||DATA.groups.some(g=>g.id===desiredCat))cat=desiredCat;}
    $('category').value=cat;makeDeck(false);
    if(!restoreView)deck.sort((a,b)=>(oldOrder.get(a.id)??100000)-(oldOrder.get(b.id)??100000));
    const desiredId=restoreView?snapshot.cardId:currentId,desiredIndex=deck.findIndex(card=>card.id===desiredId);
    if(desiredIndex>=0)index=desiredIndex;
    else if(restoreView&&Number.isSafeInteger(snapshot.position))index=Math.max(0,Math.min(snapshot.position,deck.length-1));
    else index=Math.max(0,Math.min(index,deck.length-1));
    revealed=!restoreView&&wasRevealed&&currentId===deck[index]?.id;renderCard();persist();if(tab==='list')renderList();
  }
});
`;
replace(/makeDeck\(false\);renderQuiz\(\);renderList\(\);changeTab\('study'\);/,bridge+"\nmakeDeck(false);renderQuiz();renderList();changeTab('study');");
const offline=await readFile(at('offline.html'));
const backup=`<script>try{const raw=localStorage.getItem('ielts-map-pocket-v1');if(raw!==null&&localStorage.getItem('pocket:guest-backup:v1')===null)localStorage.setItem('pocket:guest-backup:v1',raw);}catch(e){window.pocketBackupError=true;}</script>`;
replace(/<script>\r?\n'use strict';/,`<script type="application/octet-stream" id="pocketOfflineSource">${offline.toString('base64')}</script>\n${backup}\n<script>\n'use strict';`);
await build({entryPoints:[at('account/main.mjs')],outfile:at('assets/account.js'),bundle:true,minify:true,platform:'browser',format:'esm',target:['es2022'],legalComments:'eof',logLevel:'warning'});
const css=await readFile(at('account/account.css'),'utf8');await writeFile(at('assets/account.css'),css);
const hash=buffer=>createHash('sha256').update(buffer).digest('hex').slice(0,12);
const jsHash=hash(await readFile(at('assets/account.js'))),cssHash=hash(css);
replace(/<\/head>/,`<link rel="stylesheet" href="assets/account.css?v=${cssHash}">\n</head>`);
replace(/<\/body>/,`<script type="module" src="assets/account.js?v=${jsHash}"></script>\n</body>`);
if(html.match(/<script[^>]*id="studyData"[^>]*>([\s\S]*?)<\/script>/)?.[1]!==originalData)throw new Error('Lesson data changed during build');
await writeFile(at('index.html'),html);
console.log(JSON.stringify({built:true,cards:132,htmlBytes:Buffer.byteLength(html),scriptBytes:(await readFile(at('assets/account.js'))).length,jsHash,cssHash}));
