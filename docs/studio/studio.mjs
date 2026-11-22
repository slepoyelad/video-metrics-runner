import {renderReport,stamp} from './report.mjs';

const $ = id => document.getElementById(id);
const owner = location.hostname.split('.')[0];
const project = location.pathname.split('/')[1];
const prefix = 'metrics/'+project+'/';
const savedRepo = localStorage.getItem(prefix+'repo');
const requested = new URLSearchParams(location.hash.slice(1)).get('repo');
let repo = requested || savedRepo || '';
const validRepo = name => /^[\w-][\w.-]*$/.test(name);
let token = repo === savedRepo ? sessionStorage.getItem(prefix+'token') || localStorage.getItem(prefix+'token') : '';
let library, decisions, pending, busy=false, currentPlayer;
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
const status = message => {$('status').textContent=message;};
function element(tag,text,cls){
  const el=document.createElement(tag);
  if(text!=null)el.textContent=text;
  if(cls)el.className=cls;
  return el;
}
function button(label,fn){
  const b=element('button',label); b.type='button'; b.onclick=fn; return b;
}
async function api(path,{method='GET',payload,raw=false}={}){
  if(!validRepo(repo)||!token)throw Error('נדרש חיבור למאגר הפרטי.');
  const response=await fetch('https://api.github.com/repos/'+owner+'/'+repo+'/'+path,{
    method,cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
    headers:{Authorization:'Bearer '+token,Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json',...(payload?{'Content-Type':'application/json'}:{})},
    body:payload?JSON.stringify(payload):undefined
  });
  if(!response.ok)throw Error([401,403,404].includes(response.status)?'בדוק את תוקף המפתח ואת הרשאות המאגר ב־GitHub.':'שגיאה בחיבור ל־GitHub ('+response.status+').');
  return response;
}
const read=async path=>(await api('contents/'+path,{raw:true})).json();
const dispatch=(workflow,inputs)=>api('actions/workflows/'+workflow+'/dispatches',{method:'POST',payload:{ref:'main',inputs}});
const ledger=()=>read('mobile/decisions.json');
function stopPlayer(){
  if(!currentPlayer)return;
  const {el,url,abort,box,btn}=currentPlayer;
  abort.abort(); el.pause(); el.removeAttribute('src'); el.load(); box.remove();
  if(url)URL.revokeObjectURL(url);
  btn.disabled=false; currentPlayer=null;
}
function mediaButton(path,title){
  const holder=element('div',null,'media-control');
  const btn=button(title,async()=>{
    stopPlayer(); btn.disabled=true;
    const video=path.endsWith('.mp4'), el=element(video?'video':'audio');
    el.controls=true; el.playsInline=true; el.preload='metadata';
    const box=element('div'), msg=element('small','טוען מהספרייה הפרטית…');
    box.append(el,msg);holder.append(box);
    const entry={el,box,btn,abort:new AbortController()}; currentPlayer=entry;
    try{
      if(!/^media\/[a-f0-9]{64}\.(mp3|mp4)$/.test(path))throw Error('קובץ לא מוכר');
      const res=await fetch('https://api.github.com/repos/'+owner+'/'+repo+'/contents/'+path+'?ref=mobile-library',{
        headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github.raw+json'},cache:'no-store',redirect:'error',signal:entry.abort.signal});
      if(!res.ok)throw Error();
      const data=await res.blob();
      if(entry!==currentPlayer)return;
      entry.url=URL.createObjectURL(data.slice(0,data.size,video?'video/mp4':'audio/mpeg'));el.src=entry.url;
      msg.textContent='';el.onerror=()=>{msg.textContent='הנגן לא הצליח לקרוא את הקובץ.';};
      await el.play().catch(()=>{msg.textContent='לחץ על ▶ בנגן כדי להתחיל.';});
    }catch{if(currentPlayer===entry){stopPlayer();status('טעינת המדיה נכשלה. אפשר לנסות שוב.');}}
  });
  holder.append(btn);return holder;
}
function ask(action,item,version){
  if(busy)return;
  pending={action,song:item.id,version:version?.id||'',revision:String(item.revision??''),note:''};
  $('question').textContent={select:'לאשר את גרסת השיר?',approve:'להעביר למוכנים לפרסום?',correct:'לשלוח בקשת תיקון?'}[action];
  $('detail').textContent=[item.title,version?.label].filter(Boolean).join(' · ');
  $('feedback').hidden=action!=='correct'; $('note').required=action==='correct';$('note').value='';
  $('confirmDialog').showModal();
}
$('cancel').onclick=()=>$('confirmDialog').close();
$('decision').onsubmit=async event=>{
  event.preventDefault(); if(busy||!pending)return;
  const input={...pending,note:$('note').value.trim()};
  if(input.action==='correct'&&!input.note){$('note').focus();return;}
  const key=input.action==='select'?'song/'+input.song:'film/'+input.song+'/'+input.revision;
  busy=true;$('confirmDialog').close();status('שומר את ההחלטה ב־GitHub…');
  try{
    await dispatch('mobile-review.yml',input);
    for(let i=0;i<45;i++){
      await wait(3000);decisions=await ledger();
      const saved=decisions[key];
      if(!saved)continue;
      render();
      const matches=saved.action===input.action && (input.action!=='select'||saved.version===input.version) && (input.action!=='correct'||saved.note===input.note);
      status(matches?'ההחלטה נשמרה במאגר הפרטי.':'כבר נשמרה החלטה אחרת לפריט הזה.');return;
    }
    status('הבקשה נשלחה. טרם התקבל אישור שמירה מ־GitHub. אפשר לפתוח שוב את הלוח כדי לבדוק.');
  }catch(e){status(e.message);}finally{busy=false;}
};
function card(item){
  const row=element('article',null,'release'), name=element('strong',item.title);name.dir='auto';
  row.append(name,element('small',[item.language,item.format].filter(Boolean).join(' · ')));return row;
}
function shelf(title,items,empty,opened=false){
  const d=element('details',null,'list-fold'),s=element('summary'),h=element('h2',title+' ');
  d.open=opened;h.append(element('span',String(items.length),'count'));s.append(h);d.append(s);
  const body=element('div',null,'release-list');body.append(...(items.length?items:[element('p',empty,'caption')]));d.append(body);return d;
}
function render(){
  stopPlayer();const host=$('shelves'), previous=[...host.children].map(el=>el.open);
  const songs=[],review=[],ready=[],work=[];
  for(const item of library.songs){
    const row=card(item);
    if(decisions['song/'+item.id]){row.append(element('small','גרסה אושרה · ממתין להכנה'));work.push(row);continue;}
    for(const v of item.versions){
      const group=element('div',null,'version');
      if(v.audio)group.append(mediaButton(v.audio,'▶ האזנה · '+v.label),button('בחירת '+v.label,()=>ask('select',item,v)));
      else group.append(element('small',v.label+' · הקובץ ממתין לסנכרון'));
      row.append(group);
    }
    songs.push(row);
  }
  for(const item of library.films){
    const row=card(item), answer=decisions['film/'+item.id+'/'+item.revision];
    const state=item.state==='review' && answer ? (answer.action==='approve'?'final':'correction') : item.state;
    if(item.video)row.append(mediaButton(item.video,'▶ צפייה בסרטון'));
    if(item.audio)row.append(mediaButton(item.audio,'♫ האזנה לשיר'));
    if(state==='review'){
      if(item.video)row.append(button('אישור הסרטון',()=>ask('approve',item)),button('בקשת תיקון',()=>ask('correct',item)));
      review.push(row);
    }else if(state==='final'){
      if(item.due)row.append(element('small','מועד מוצע · '+stamp(item.due)+' (ישראל)'));ready.push(row);
    }else{row.append(element('small',state==='correction'?'בתיקון · '+(answer?.note||item.note||''):'בהכנה'));work.push(row);}
  }
  for(const p of library.preparation||[]){if(!library.films.some(f=>f.id===p.id))work.push(card(p));}
  host.replaceChildren(shelf('אישור Suno',songs,'אין כרגע גרסאות שממתינות לבחירה.',previous[0]??!!songs.length),
    shelf('מחכים לאישור',review,'כל הסקיצות נבדקו.',previous[1]??!!review.length),
    shelf('בעבודה ובתיקון',work,'אין כרגע עבודות בהכנה.',previous[2]),
    shelf('מוכנים לפרסום',ready,'התור ריק.',previous[3]??(!songs.length&&!review.length)));
  $('updated').textContent='סנכרון ספרייה · '+stamp(library.updatedAt);
}
async function metrics(){const r=await read('report.json');$('metrics').innerHTML=renderReport(r);return r;}
async function openDesk(){
  [library,decisions]=await Promise.all([read('library.json?ref=mobile-library'),ledger()]);
  render();$('desk').hidden=false;$('login').hidden=true;status('');
  await metrics().catch(e=>{$('metrics').textContent=e.message;});
}
$('refresh').onclick=async()=>{
  $('refresh').disabled=true;
  try{
    const id=crypto.randomUUID();await dispatch('refresh.yml',{request_id:id});status('בודק את המדדים בשלוש הפלטפורמות…');
    for(let i=0;i<45;i++){await wait(4000);if((await metrics()).requestId===id){status('המדדים עודכנו.');return;}}
    status('בדיקת המדדים עדיין בתור ב־GitHub.');
  }catch(e){status(e.message);}finally{$('refresh').disabled=false;}
};
$('repo').value=repo;$('repoLabel').hidden=!!repo&&validRepo(repo);
$('login').querySelector('form').onsubmit=async event=>{
  event.preventDefault();repo=$('repo').value.trim();token=$('token').value.trim();
  try{await openDesk();localStorage.setItem(prefix+'repo',repo);
    [localStorage,sessionStorage].forEach(s=>s.removeItem(prefix+'token'));
    ($('remember').checked?localStorage:sessionStorage).setItem(prefix+'token',token);$('token').value='';
  }catch(e){status(e.message);}
};
$('disconnect').onclick=()=>{stopPlayer();[sessionStorage,localStorage].forEach(s=>s.removeItem(prefix+'token'));location.reload();};
if(token&&validRepo(repo)){openDesk().catch(e=>{status(e.message);$('login').hidden=false;});}
else $('login').hidden=false;
