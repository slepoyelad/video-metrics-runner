const $=id=>document.getElementById(id);
const owner=location.hostname.split('.')[0], runner=location.pathname.split('/')[1];
const key='metrics/'+runner+'/', api='https://api.github.com/repos/'+owner+'/';
const requested=new URLSearchParams(location.hash.slice(1)).get('repo');
if(requested&&/^[\w.-]+$/.test(requested))localStorage.setItem(key+'repo',requested);
let repo=localStorage.getItem(key+'repo')||'',token=sessionStorage.getItem(key+'token')||localStorage.getItem(key+'token')||'';
const names={youtube:'YouTube',instagram:'Instagram',tiktok:'TikTok'},metrics={views:'צפיות',reactions:'לייקים',comments:'תגובות'};
const clock=new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',dateStyle:'short',timeStyle:'short'});
const time=s=>s?clock.format(new Date(s)):'—';
const node=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;};
function nativeLink(){const r=$('repo').value.trim();$('native').href=/^[\w.-]+$/.test(r)?'https://github.com/'+owner+'/'+r:'https://github.com/'+owner;}
$('repo').value=repo;$('repo').oninput=nativeLink;nativeLink();
async function call(path,options={}){
  const res=await fetch(api+path,{redirect:'error',cache:'no-store',...options,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',...options.headers}});
  if(!res.ok)throw Error([401,403,404].includes(res.status)?'בדוק שהמפתח בתוקף ושיש לו גישה לשני המאגרים.':'GitHub החזיר שגיאה '+res.status);
  return res;
}
async function loadReport(){
  const res=await call(repo+'/contents/report.json',{headers:{Accept:'application/vnd.github.raw+json'}});
  const r=await res.json();if(!Array.isArray(r.channels))throw Error('הדוח אינו זמין.');
  $('cards').replaceChildren();$('videos').replaceChildren();const groups=new Map();
  $('updated').textContent='בדיקה אחרונה · '+time(r.fetchedAt)+' (שעון ישראל)';
  for(const c of r.channels){
    const card=node('article');card.className=c.service;card.append(node('h3',names[c.service]),node('small','@'+c.label));const nums=node('div');nums.className='numbers';
    for(const [k,label] of Object.entries(metrics)){
      const values=c.posts.map(p=>{const m=(p.metrics||[]).find(x=>x.type===k&&Number.isFinite(x.value));return m&&{n:m.value,at:m.observedAt||p.metricsUpdatedAt};}).filter(Boolean);
      const d=node('div');d.append(node('span',label),node('strong',values.length?values.reduce((a,b)=>a+b.n,0).toLocaleString('he-IL'):'—'));
      const oldest=values.map(v=>v.at).filter(Boolean).sort()[0];
      if(values.length)d.append(node('small',time(oldest)));
      if(oldest&&r.runStarted&&oldest<r.runStarted)d.append(node('small','מדידה קודמת'));
      if(values.length&&values.length<c.posts.length)d.append(node('small',values.length+' מתוך '+c.posts.length));
      nums.append(d);
    }
    card.append(nums);$('cards').append(card);
    for(const p of c.posts){const id=p.clipId||c.service+'/'+p.id;if(!groups.has(id))groups.set(id,[]);groups.get(id).push({...p,service:c.service});}
  }
  for(const posts of groups.values()){
    const item=node('details'),head=node('summary',posts[0].clipTitle||posts[0].text||'סרטון');head.dir='auto';item.append(head);
    const links=node('div');links.className='links';
    for(const p of posts){try{const u=new URL(p.externalLink),hosts={youtube:['youtube.com','www.youtube.com','youtu.be'],instagram:['instagram.com','www.instagram.com'],tiktok:['tiktok.com','www.tiktok.com']};if(u.protocol!=='https:'||!hosts[p.service]?.includes(u.hostname))continue;const a=node('a',names[p.service]);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}catch{}}
    item.append(links);$('videos').append(item);
  }
  $('report').hidden=false;$('login').hidden=true;$('refresh').hidden=false;return r;
}
document.querySelector('form').onsubmit=async e=>{e.preventDefault();repo=$('repo').value.trim();token=$('token').value.trim();try{
  await loadReport();localStorage.setItem(key+'repo',repo);( $('remember').checked?localStorage:sessionStorage).setItem(key+'token',token);$('token').value='';$('status').textContent='';
}catch(err){$('status').textContent=err.message;}};
$('disconnect').onclick=()=>{sessionStorage.removeItem(key+'token');localStorage.removeItem(key+'token');location.reload();};
$('refresh').onclick=async()=>{const button=$('refresh');button.disabled=true;const id=crypto.randomUUID();
  try{await call(runner+'/actions/workflows/refresh.yml/dispatches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:'main',inputs:{request_id:id}})});
    $('status').textContent='GitHub בודק את המונים. התוצאות יופיעו כאן.';let completed=false;
    for(let i=0;i<45;i++){await new Promise(ok=>setTimeout(ok,4000));const r=await loadReport();if(r.requestId===id){completed=true;break;}}
    $('status').textContent=completed?'הבדיקה הסתיימה. שעת המדידה מופיעה ליד כל מונה.':'התוצאה עדיין לא הגיעה. אפשר לפתוח את הדף שוב בהמשך.';
  }catch(err){$('status').textContent=err.message;}finally{button.disabled=false;}};
if(repo&&token)loadReport().catch(err=>{$('status').textContent=err.message;});
