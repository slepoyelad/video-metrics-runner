import {renderReport,stamp} from './report.mjs?v=ig-totals-1';
import {openLyrics,renderTakes} from './lyrics-ui.mjs?v=suno-review-1';
import {showInquiry} from './inquiry-ui.mjs?v=repair';

const $ = id => document.getElementById(id);
const owner = location.hostname.split('.')[0];
const project = location.pathname.split('/')[1];
const prefix = 'metrics/'+project+'/';
const savedRepo = localStorage.getItem(prefix+'repo');
const requested = new URLSearchParams(location.hash.slice(1)).get('repo');
let repo = requested || savedRepo || '';
const validRepo = name => /^[\w-][\w.-]*$/.test(name);
let token = repo === savedRepo ? sessionStorage.getItem(prefix+'token') || localStorage.getItem(prefix+'token') : '';
let library, decisions, pending, busy=false, currentPlayer, closeEmbed;
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
  if(!response.ok){
    const code=response.status;
    if(code===401){
      for(const storage of [sessionStorage,localStorage])storage.removeItem(prefix+'token');
      $('login').querySelector('details').open=true;
      throw Error('GitHub דחה את המפתח (401). הדבק את הקוד המלא ממנהל הסיסמאות. אם הוא אבד או פג תוקפו, השתמש בקישור ליצירת מפתח חדש.');
    }
    if(code===429 || (code===403 && (response.headers.get('x-ratelimit-remaining')==='0' || response.headers.has('retry-after'))))
      throw Error('GitHub הגביל זמנית את מספר הבקשות ('+code+'). נסה שוב מאוחר יותר עם אותו מפתח.');
    if(code===403 || code===404){
      const access=method==='GET'?'Contents → Read-only':'Actions → Read and write';
      throw Error('הבקשה ל־'+owner+'/'+repo+' לא הצליחה ('+code+'). בהגדרות המפתח ודא שהמאגר מסומן ושיש הרשאת '+access+'.');
    }
    throw Error('שגיאה בחיבור ל־GitHub ('+code+').');
  }
  return response;
}
const read=async path=>(await api('contents/'+path,{raw:true})).json();
const dispatch=(workflow,inputs)=>api('actions/workflows/'+workflow+'/dispatches',{method:'POST',payload:{ref:'main',inputs}});
const ledger=()=>read('mobile/decisions.json');
let bookings=[], bookingError=false;
let queueOrder={revision:'initial',slots:{},waiting:{}};
async function readBookings(){
  const rows=[];
  for(let page=1;;page++){
    const releases=await (await api('releases?per_page=100&page='+page)).json();
    for(const release of releases){
      if(release.draft||!release.tag_name.startsWith('lr-film-'))continue;
      const job=JSON.parse(release.body);
      if(!job.approved)continue;
      const states=Object.values(job.platforms).map(p=>p.state);
      rows.push({id:release.tag_name.slice(8),title:job.title,language:job.language,format:job.format,
        due:job.due,standby:!!job.standby,states,digest:job.sha256,asset:release.assets.find(a=>a.name==='video.mp4')?.browser_download_url});
    }
    if(releases.length<100)return rows.sort((a,b)=>Date.parse(a.due)-Date.parse(b.due));
  }
}
async function updateBookings(){
  try{
    const [next,order]=await Promise.all([readBookings(),read('publishing/queue-order.json')]);
    for(const job of next){
      const swap=order.slots[job.id];
      job.due=swap?.original===job.due?swap.due:job.standby?null:job.due;
    }
    next.sort((a,b)=>(Date.parse(a.due)||Infinity)-(Date.parse(b.due)||Infinity));
    const changed=bookingError||order.revision!==queueOrder.revision||JSON.stringify(next)!==JSON.stringify(bookings);
    queueOrder=order;bookings=next;bookingError=false;return changed;
  }catch{
    const changed=!bookingError;bookingError=true;return changed;
  }
}
function stopPlayer(){
  if(closeEmbed){closeEmbed();closeEmbed=null;}
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
  const rerun=action==='rerun', replace=action==='replace', needsNote=rerun||action==='correct';
  const clips=replace?[...new Set(item.versions.map(v=>v.id))].sort():[];
  pending={action,song:item.id,version:replace?clips.join(','):version?.id||'',revision:rerun||replace?item.runRevision:String(item.revision??''),note:''};
  $('question').textContent={select:'לאשר את גרסת השיר?',approve:'להעביר למוכנים לפרסום?',correct:'לשלוח בקשת תיקון?',rerun:'להפיק שתי גרסאות חדשות ב־Suno?',replace:'למחוק את הרעיון ולהכין רעיון חדש?'}[action];
  $('detail').textContent=[item.title,version?.label,replace?(clips.length?clips.length+' גרסאות יועברו לפח ב־Suno. המקום יתפנה לרעיון אחר.':'טיוטת המילים תוסר מהלוח.'):null,rerun||(replace&&clips.length)?'עלות לזוג חדש · '+item.rerunCost+' קרדיטים במסגרת המכסה':null].filter(Boolean).join(' · ');
  $('confirm').textContent=replace?'אישור מחיקה והחלפה':'אישור';
  $('feedback').hidden=!needsNote; $('note').required=needsNote;$('note').maxLength=rerun?350:800;$('note').value='';
  $('noteLabel').textContent=rerun?'מה לשנות בביצוע?':'מה לתקן בסקיצה?';
  $('musicHint').hidden=!rerun;
  $('confirmDialog').showModal();
  if(replace)$('cancel').focus();
}
$('cancel').onclick=()=>$('confirmDialog').close();
$('decision').onsubmit=async event=>{
  event.preventDefault(); if(busy||!pending)return;
  const input={...pending,note:$('note').value.trim()};
  if(['correct','rerun'].includes(input.action)&&!input.note){$('note').focus();return;}
  const key=['replace','rerun'].includes(input.action)?input.action+'/'+input.song+'/'+input.revision:
    input.action==='select'?'song/'+input.song:'film/'+input.song+'/'+input.revision;
  busy=true;$('confirmDialog').close();status('שומר את ההחלטה ב־GitHub…');
  try{
    await dispatch('mobile-review.yml',input);
    for(let i=0;i<45;i++){
      await wait(3000);decisions=await ledger();
      const saved=decisions[key];
      if(!saved)continue;
      render();
      const matches=saved.action===input.action && (input.action!=='select'||saved.version===input.version) && (!['correct','rerun'].includes(input.action)||saved.note===input.note);
      status(matches?(input.action==='replace'?'ההחלפה נשמרה ותטופל כשהמחשב מחובר ל־Suno.':input.action==='rerun'?'הדגשים נשמרו. ההפקה תתחיל כשהמחשב מחובר ל־Suno.':'ההחלטה נשמרה במאגר הפרטי.'):'כבר נשמרה בקשה אחרת לפריט הזה.');return;
    }
    status('הבקשה נשלחה. טרם התקבל אישור שמירה מ־GitHub. אפשר לפתוח שוב את הלוח כדי לבדוק.');
  }catch(e){status(e.message);}finally{busy=false;}
};
function card(item){
  const row=element('article',null,'release'), name=element('strong',item.title);name.dir='auto';
  row.append(name,element('small',[item.language,item.format].filter(Boolean).join(' · ')));return row;
}
function inquiryButton(row,item){
  const info=item.inquiry;
  if(!info)return;
  const key='inquire/'+info.incident+'/'+info.attempt;
  showInquiry(row,info,async()=>{
    await dispatch('mobile-review.yml',{action:'inquire',song:item.id,version:info.incident,revision:String(info.attempt)});
    for(let i=0;i<40;i++){
      await wait(3000);
      if((await ledger())[key]){decisions[key]=true;return 'הבקשה נשמרה וממתינה לסנכרון עם המחשב.';}
    }
    throw Error('בקשת השליחה יצאה, וטרם התקבל אישור שמירה. אפשר לרענן ולבדוק.');
  },Boolean(decisions[key]&&['new','failed'].includes(info.state)));
}
function shelf(title,items,empty,opened=false){
  const d=element('details',null,'list-fold'),s=element('summary'),h=element('h2',title+' ');
  d.open=opened;h.append(element('span',String(items.length),'count'));s.append(h);d.append(s);
  const body=element('div',null,'release-list');body.append(...(items.length?items:[element('p',empty,'caption')]));d.append(body);return d;
}
async function moveFilm(first,second){
  if(busy||bookingError)return;
  const assign=Boolean(first.due)!==Boolean(second.due);
  const incoming=first.due?second:first, outgoing=first.due?first:second;
  if(assign&&!window.confirm('לשבץ את '+incoming.title+' ב־'+stamp(outgoing.due)+' במקום '+outgoing.title+'? הסרטון שיוחלף יחכה למועד חדש.'))return;
  busy=true;
  const request=crypto.randomUUID();
  const change={first:first.id,second:second.id,first_due:first.due,second_due:second.due,revision:queueOrder.revision,request,assign,digest:incoming.digest};
  const buttons=document.querySelectorAll('#qbox .queue-move button,#qbox .queue-move select');
  for(const b of buttons)b.disabled=true;
  const selectedRow=()=>Array.from(document.querySelectorAll('#qbox article')).find(el=>el.dataset.song===first.id);
  const message=element('small','שומר את המקום החדש…','move-feedback');message.setAttribute('role','status');selectedRow()?.prepend(message);
  const notify=m=>{status(m);const hint=$('queueNotice');if(hint)hint.textContent=m;};
  notify('שומר את ההחלפה בין '+first.title+' לבין '+second.title+'…');
  let result='';
  try{
    await dispatch('queue-order.yml',{request_id:request,move:JSON.stringify(change)});
    for(let i=0;i<40;i++){
      await wait(3000);
      const order=await read('publishing/queue-order.json');
      if(order.revision===request){result='נשמר · '+first.title+' ו־'+second.title+' החליפו מקומות.';return;}
      if(order.revision!==change.revision)throw Error('התור השתנה במכשיר אחר. בדוק את הסדר המעודכן.');
      if(i%3===2){
        const runs=await (await api('actions/workflows/queue-order.yml/runs?event=workflow_dispatch&per_page=10')).json();
        const run=runs.workflow_runs.find(r=>r.display_title==='Queue move '+request);
        if(run?.status==='completed'&&run.conclusion!=='success')throw Error('השינוי נדחה. בדוק את המועדים המעודכנים ונסה שוב.');
      }
    }
    result='הבקשה עדיין בתור ב־GitHub. הסדר יתעדכן לאחר השמירה.';
  }catch(e){result=e.message;}finally{
    await updateBookings();busy=false;render();notify(result);
    const moved=selectedRow();moved?.prepend(element('small',result,'move-feedback'));
    if($('qbox').open)moved?.scrollIntoView({block:'center',behavior:'smooth'});
  }
}
function moveControls(row,item,items){
  const peers=items.filter(x=>x.format===item.format);
  const i=peers.findIndex(x=>x.id===item.id),group=element('div',null,'queue-move');
  const select=element('select');
  select.setAttribute('aria-label','העברת '+item.title+' למקום אחר');
  select.append(new Option('בחירת מקום…',''));
  for(const peer of peers.filter(x=>x.id!==item.id)){
    select.append(new Option('#'+(items.indexOf(peer)+1)+' · '+peer.title+(peer.due?' · '+stamp(peer.due):' · ממתין למועד'),peer.id));
  }
  select.disabled=i<0||peers.length<2||bookingError;
  select.onchange=()=>{const target=peers.find(p=>p.id===select.value);select.value='';if(target)moveFilm(item,target);};
  for(const [step,label,mark] of [[-1,'הקדמה','▲'],[1,'דחייה','▼']]){
    const other=i<0?null:peers[i+step],b=button(mark,()=>moveFilm(item,other));
    b.disabled=busy||bookingError||!other;
    b.title=other?label+' · החלפה עם '+other.title:label+' · אין משבצת זמינה';
    b.setAttribute('aria-label',b.title);group.append(b);
  }
  group.append(select);row.prepend(group);
}
function render(){
  stopPlayer();const host=$('shelves');
  const expanded=id=>host.querySelector('#'+id)?.open??false;
  const songs=[],drafts=[],review=[],ready=[],work=[];
  const active=bookings.filter(j=>!j.states.includes('published')&&!j.states.every(s=>s==='inbox'));
  const finals=library.films.filter(f=>f.state==='final'&&!bookings.some(j=>j.id===f.id))
    .map(f=>({...f,proposal:f.due,due:null,digest:f.video?.slice(6,-4)}));
  const waiting=[...active.filter(j=>!j.due),...finals];
  for(const [format,ids] of Object.entries(queueOrder.waiting)){
    const same=waiting.filter(f=>f.format===format);
    const ranked=[...new Set([...ids.map(id=>same.find(f=>f.id===id)).filter(Boolean),...same])];
    let i=0;waiting.forEach((f,n)=>{if(f.format===format)waiting[n]=ranked[i++];});
  }
  const all=[...active.filter(j=>j.due),...waiting];
  const movable=all.filter(j=>(!j.states||j.states.length&&j.states.every(s=>s==='queued'))&&(!j.due||Date.parse(j.due)>Date.now()+60000));
  for(const job of all){
    const row=card(job);
    row.dataset.song=job.id;
    const label=job.states?.every(s=>s==='queued')?'מתוזמן':job.states?.includes('needs_connection')?'נדרש חיבור לערוץ':'בתהליך פרסום';
    row.append(element('small','#'+(ready.length+1)+' · '+(job.due?label+' · '+stamp(job.due)+' (ישראל)':'ממתין למועד')));
    moveControls(row,job,movable);
    if(job.asset){
      if(/^[a-f0-9]{64}$/.test(job.digest))row.append(mediaButton('media/'+job.digest+'.mp4','▶ צפייה בסרטון המתוזמן'));
      const link=element('a','הורדת הסרטון המתוזמן');
      link.href=job.asset;link.target='_blank';link.rel='noopener noreferrer';row.append(link);
    }else if(job.video)row.append(mediaButton(job.video,'▶ צפייה בסרטון'));
    ready.push(row);
  }
  for(const item of library.songs){
    const row=card(item);
    row.prepend(element('em',item.format==='צ׳יל'?'ראפ צ׳יל · הנחיית 98 BPM':'ראפ מרכזי'));
    if(decisions['song/'+item.id]){row.append(element('small','גרסה אושרה · ממתין להכנה'));work.push(row);continue;}
    const replacement=decisions['replace/'+item.id+'/'+item.runRevision];
    if(replacement?.clips.join(',')===[...new Set(item.versions.map(v=>v.id))].sort().join(',')){
      row.append(element('small','החלפת הרעיון ממתינה לסנכרון'));work.push(row);continue;
    }
    const request=decisions['rerun/'+item.id+'/'+item.runRevision];
    const waiting=Boolean(item.rerunPending || (request&&!item.rerunMessage));
    function selectButton(v){
      const b=button('בחירה',()=>ask('select',item,v));b.disabled=waiting;return b;
    }
    if(item.versions.length)row.append(renderTakes(item.versions,v=>{
      const group=element('div',null,'version');
      if(v.audio)group.append(mediaButton(v.audio,'▶ האזנה'),selectButton(v));
      else if(/^[0-9a-f-]{36}$/.test(v.id)&&v.suno==='https://suno.com/song/'+v.id){
        const listen=button('▶ האזנה',()=>{
          stopPlayer();
          const frame=element('iframe');frame.title=item.title+' · '+v.label;
          frame.allow='autoplay';frame.src='https://suno.com/embed/'+v.id;
          const link=element('a','פתיחה בחשבון Suno ↗');link.href=v.suno;link.target='_blank';link.rel='noopener noreferrer';
          listen.replaceWith(frame,link);closeEmbed=()=>{frame.replaceWith(listen);link.remove();};
        });
        group.append(listen,selectButton(v));
      }else group.append(element('small',v.label+' · הקובץ ממתין לסנכרון'));
      return group;
    }));
    if(item.rerunnable){
      const rerun=button('שינוי ביצוע',()=>ask('rerun',item));
      rerun.disabled=Boolean(request)||item.rerunPending;row.append(rerun);
      if(item.rerunMessage)row.append(element('small',item.rerunMessage));
      else if(waiting)row.append(element('small',item.rerunPending?'Suno מטפל בהפקה.':'הבקשה נשמרה וממתינה להפקה.'));
      if(request)row.append(element('small',request.note));
      if(item.lyricDraft){
        const d=item.lyricDraft;
        const suffix='/'+item.id+'/'+d.id+'/'+item.runRevision;
        const queued=decisions['rewrite'+suffix]||decisions['produce'+suffix];
        const rewrite=button(d.state==='ready'?'קריאה ואישור המילים':'שכתוב מילים',()=>openLyrics({...item,rerunPending:waiting||!!queued},item.rerunCost,async(action,draft,note)=>{
          await dispatch('mobile-review.yml',{action,song:item.id,revision:item.runRevision,version:draft,note});
          status('הבקשה נשלחה לסנכרון עם חדר העריכה.');
          for(let i=0;i<40;i++){
            await wait(3000);decisions=await ledger();
            if(decisions[action+suffix]){render();return;}
          }
          throw Error('הבקשה נשלחה. טרם התקבל אישור שמירה, יש לרענן לפני ניסיון נוסף.');
        }));
        row.append(rewrite);
        if(item.lyricIssue||queued||d.state==='ready'||d.state==='writing')row.append(element('small',item.lyricIssue||(queued?'הבקשה ממתינה לסנכרון':d.state==='writing'?'Codex מכין טיוטה':'טיוטת מילים מחכה לקריאה')));
      }
    }
    const replace=button('מחיקת רעיון ויצירת רעיון חדש',()=>ask('replace',item));
    const unrecordedDraft=item.runRevision==='initial'&&['ready','writing','error'].includes(item.lyricDraft?.state);
    replace.disabled=waiting||(!item.versions.length&&!unrecordedDraft)||item.versions.some(v=>v.suno!=='https://suno.com/song/'+v.id);
    const more=element('details');more.append(element('summary','פעולות נוספות'),replace);row.append(more);
    if(item.versions.length)songs.push(row);
    else{row.prepend(element('small','טיוטת מילים לאישור'));drafts.push(row);}
  }
  for(const item of library.films){
    if(bookings.some(job=>job.id===item.id)||item.state==='final')continue;
    const row=card(item), answer=decisions['film/'+item.id+'/'+item.revision];
    const state=item.state==='review' && answer ? (answer.action==='approve'?'final':'correction') : item.state;
    if(item.video)row.append(mediaButton(item.video,'▶ צפייה בסרטון'));
    if(item.audio)row.append(mediaButton(item.audio,'♫ האזנה לשיר'));
    if(state==='review'){
      if(item.video)row.append(button('אישור הסרטון',()=>ask('approve',item)),button('בקשת תיקון',()=>ask('correct',item)));
      review.push(row);
    }else if(state==='final'){
      row.append(element('small','האישור מסתנכרן עם הספרייה.'));
      if(item.due)row.append(element('small','מועד מוצע · '+stamp(item.due)+' (ישראל)'));ready.push(row);
    }else{
      const message=state==='error'?(item.issue||'הכנת הסרטון נעצרה.'):state==='correction'?'בתיקון · '+(answer?.note||item.note||''):'בהכנה';
      row.append(element('small',message));inquiryButton(row,item);work.push(row);
    }
  }
  for(const p of library.preparation||[]){
    if(library.films.some(f=>f.id===p.id))continue;
    const row=card(p);
    if(p.message)row.append(element('small',p.message));
    inquiryButton(row,p);
    if(p.audio)row.append(mediaButton(p.audio,'♫ האזנה לגרסה שאושרה'));
    work.push(row);
  }
  const music=shelf('אישור Suno',songs,'אין כרגע גרסאות שממתינות לבחירה.',expanded('songsFold'));music.id='songsFold';
  const musicBody=music.querySelector('.release-list');
  for(const [format,message] of Object.entries(library.refillStatus||{}))musicBody.append(element('small','ראפ '+format+' · '+message));
  musicBody.append(...drafts);
  if(library.musicPlan?.catchUp)music.querySelector('.release-list').prepend(element('small','מכינים צ׳יל עד לאיזון תור הפרסום.'));
  const reviewSection=element('section'), heading=element('h2','מחכים לאישור ','stage');
  heading.append(element('span',String(review.length),'count'));reviewSection.append(heading);
  const panel=element('div',null,'card'), fold=element('details');fold.id='reviewFold';fold.open=expanded('reviewFold');
  if(review.length)panel.append(review[0]);
  fold.append(element('summary','כל הסרטונים שמחכים לאישור'),...(review.length>1?review.slice(1):[element('p',review.length?'הסקיצה מופיעה למעלה.':'כל הסקיצות נבדקו.','caption')]));
  panel.append(fold);reviewSection.append(panel);
  const queue=shelf('מוכנים לפרסום',ready,'התור ריק.',expanded('qbox'));queue.id='qbox';
  const notice=element('small');notice.id='queueNotice';notice.setAttribute('role','status');
  queue.querySelector('.release-list').prepend(notice);
  if(bookingError){
    const body=queue.querySelector('.release-list');
    if(!ready.length){body.replaceChildren();queue.querySelector('.count').textContent='—';}
    body.prepend(element('small','עדכון התזמונים מ־GitHub נכשל. אפשר לרענן כדי לנסות שוב.'));
  }
  queue.querySelector('h2').append(element('small','צ׳יל 17:00 · ראפ מרכזי 23:00','slot'));
  const progress=shelf('בעבודה ובתיקון',work,'',expanded('workBox'));progress.id='workBox';progress.hidden=!work.length;
  host.replaceChildren(music,reviewSection,queue,progress);
}
let metricsRequest, displayedReport;
function metrics(){
  if(metricsRequest)return metricsRequest;
  metricsRequest=read('report.json').then(r=>{
    if(displayedReport && Date.parse(r.fetchedAt)<=Date.parse(displayedReport.fetchedAt)){
      $('updated').textContent='מדידה אחרונה · '+stamp(displayedReport.fetchedAt);
      return displayedReport;
    }
    const host=$('metrics');
    const opened=['.pf-analysis','#numbers .fold','#publishedFold'].filter(s=>host.querySelector(s)?.open);
    host.innerHTML=renderReport(r);
    for(const selector of opened)host.querySelector(selector).open=true;
    $('updated').textContent='מדידה אחרונה · '+stamp(r.fetchedAt);
    displayedReport=r;
    return r;
  }).finally(()=>{metricsRequest=null;});
  return metricsRequest;
}
async function openDesk(){
  [library,decisions]=await Promise.all([read('library.json?ref=mobile-library'),ledger(),updateBookings()]);
  render();$('desk').hidden=false;$('login').hidden=true;status('');
  $('history').hidden=false;$('topRefresh').hidden=false;
  api('contents/avatar.png?ref=mobile-library',{raw:true}).then(r=>r.blob()).then(b=>{
    $('avatar').src=URL.createObjectURL(b.slice(0,b.size,'image/png'));$('avatar').hidden=false;
  }).catch(()=>{});
  await metrics().catch(e=>{$('metrics').textContent=e.message;});
}
$('topRefresh').onclick=async()=>{
  $('topRefresh').disabled=true;
  try{
    const id=crypto.randomUUID();await dispatch('refresh.yml',{request_id:id});status('בודק את המדדים בשלוש הפלטפורמות…');
    for(let i=0;i<45;i++){await wait(4000);if((await metrics()).requestId===id){status('המדדים עודכנו.');return;}}
    status('בדיקת המדדים עדיין בתור ב־GitHub.');
  }catch(e){status(e.message);}finally{$('topRefresh').disabled=false;}
};
$('repo').value=repo;$('repoLabel').hidden=!!repo&&validRepo(repo);
$('repoHint').textContent=repo;
$('history').onclick=()=>{const box=$('publishedFold');if(box)box.open=true;};
$('login').querySelector('form').onsubmit=async event=>{
  event.preventDefault();repo=$('repo').value.trim();
  const pasted=$('token').value.replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').trim().replace(/^Bearer\s+/i,'').replace(/\s+/g,'');
  if(!/^(github_pat_|ghp_)[a-zA-Z0-9_]+$/.test(pasted)){
    $('login').querySelector('details').open=true;
    status('הדבק את קוד המפתח המלא שקיבלת מ־GitHub. מפתח Fine-grained מתחיל ב־github_pat_.');return;
  }
  token=pasted;
  try{await openDesk();localStorage.setItem(prefix+'repo',repo);
    [localStorage,sessionStorage].forEach(s=>s.removeItem(prefix+'token'));
    ($('remember').checked?localStorage:sessionStorage).setItem(prefix+'token',token);$('token').value='';
  }catch(e){status(e.message);}
};
$('disconnect').onclick=()=>{stopPlayer();[sessionStorage,localStorage].forEach(s=>s.removeItem(prefix+'token'));location.reload();};
if(token&&validRepo(repo)){openDesk().catch(e=>{status(e.message);$('login').hidden=false;});}
else $('login').hidden=false;
async function updateLibrary(){
  if(document.hidden||$('desk').hidden||busy||currentPlayer||closeEmbed||$('confirmDialog').open)return;
  try{
    const [newLib,newDecisions,bookingsChanged]=await Promise.all([read('library.json?ref=mobile-library'),ledger(),updateBookings()]);
    if(currentPlayer||closeEmbed||busy||$('confirmDialog').open)return;
    if(bookingsChanged||newLib.updatedAt!==library.updatedAt||JSON.stringify(newDecisions)!==JSON.stringify(decisions)){
      library=newLib;decisions=newDecisions;render();
    }
  }catch{/* Keep the latest loaded view during transient connection loss. */}
}
function syncVisibleReport(){
  if(document.hidden||$('desk').hidden||$('topRefresh').disabled)return;
  metrics().catch(()=>{$('updated').textContent=displayedReport?'מדידה אחרונה · '+stamp(displayedReport.fetchedAt)+' · ממתין לסנכרון':'ממתין לסנכרון הנתונים';});
}
document.addEventListener('visibilitychange',updateLibrary);
document.addEventListener('visibilitychange',syncVisibleReport);
window.addEventListener('focus',syncVisibleReport);
setInterval(()=>{syncVisibleReport();updateLibrary();},60000);
