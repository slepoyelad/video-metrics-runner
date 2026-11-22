const services={instagram:'אינסטגרם',youtube:'יוטיוב',tiktok:'טיקטוק'};
const hosts={instagram:['www.instagram.com','instagram.com'],youtube:['youtube.com','www.youtube.com','youtu.be'],tiktok:['tiktok.com','www.tiktok.com']};
const number=new Intl.NumberFormat('he-IL');
export const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const stamp=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—';
function href(value,allowed){
  try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&allowed.includes(u.hostname))return esc(u.href);}catch{}
  return '';
}
const platformNames={instagram:'אינסטגרם',youtube:'יוטיוב',tiktok:'טיקטוק'};
const platforms=Object.keys(platformNames);
const metricNames={videos:'סרטונים',views:'צפיות',reactions:'לייקים',comments:'תגובות',followers:'עוקבים'};
const formatted=value=>Number.isFinite(value)?number.format(value):'—';
function groupKey(p,service){return p.clipId||service+'/'+p.id;}
function postMetric(p,key){return p.metrics?.find(m=>m.type===key && Number.isFinite(m.value))?.value;}
export function observation(r){
  const rows={}, clips=new Set();
  for(const c of r.channels.filter(c=>platforms.includes(c.service))){
    const posts=c.posts||[];
    for(const p of posts)clips.add(groupKey(p,c.service));
    const row={videos:posts.length,followers:c.followers,stale:[]};
    if(c.followersUnavailable&&Number.isFinite(c.followers))row.stale.push('followers');
    for(const key of ['views','reactions','comments']){
      const values=posts.map(p=>postMetric(p,key));
      row[key]=(posts.length||!c.measurementErrors?.length)&&values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0):null;
      if(posts.some(p=>{const m=p.metrics?.find(m=>m.type===key);return m&&((m.observedAt&&r.runStarted)?m.observedAt<r.runStarted:c.measurementErrors?.length)}))row.stale.push(key);
    }
    rows[c.service]=row;
  }
  return {at:r.fetchedAt,platforms:rows,videos:clips.size};
}
function total(point,key){
  if(!point)return null;
  if(key==='videos')return platforms.every(s=>point.platforms[s])?point.videos:null;
  const values=platforms.map(s=>point.platforms[s]?.[key]);
  const known=values.filter(Number.isFinite);
  return known.length?known.reduce((sum,value)=>sum+value,0):null;
}
function kpi(key,current,previous){
  const value=total(current,key),before=total(previous,key);
  let change='';
  const coverage=p=>platforms.filter(s=>Number.isFinite(p?.platforms[s]?.[key])).length;
  const stale=p=>platforms.some(s=>p?.platforms[s]?.stale?.includes(key));
  if(Number.isFinite(value)&&coverage(current)<platforms.length)change='<small class="change same">סכום חלקי</small>';
  else if(stale(current))change='<small class="change same">כולל נתון קודם</small>';
  else if(Number.isFinite(value)&&Number.isFinite(before)&&coverage(previous)===platforms.length&&!stale(previous)){
    const delta=value-before;
    change=delta===0?'<small class="change same">ללא שינוי</small>':
      '<div class="pf-change"><small class="change '+(delta>0?'up':'down')+'"><bdi>'+(delta>0?'▲ +':'▼ ')+formatted(delta)+'</bdi></small><small>היה '+formatted(before)+'</small></div>';
  }
  return '<article class="kpi"><strong>'+formatted(value)+'</strong><span>'+(key==='videos'?'סרטונים שפורסמו':metricNames[key])+'</span>'+change+'</article>';
}
function chart(points,key){
  const ts=p=>Date.parse(p.at),start=ts(points[0]),end=ts(points.at(-1));
  const max=Math.max(1,...points.flatMap(p=>platforms.map(s=>p.platforms[s]?.[key]??0)));
  const x=p=>14+450*(ts(p)-start)/Math.max(1,end-start);
  let lines='';
  for(const s of platforms){
    let segment=[];
    const flush=()=>{if(segment.length)lines+='<polyline class="pf-line '+s+'" points="'+segment.join(' ')+'"/>';segment=[];};
    for(const p of points){
      const v=p.platforms[s]?.[key];
      if(!Number.isFinite(v)||p.platforms[s]?.stale?.includes(key)){flush();continue;}
      const cx=x(p).toFixed(1),cy=(96-82*v/max).toFixed(1);
      segment.push(cx+','+cy);
      lines+='<circle class="pf-point '+s+'" cx="'+cx+'" cy="'+cy+'" r="2.8"><title>'+platformNames[s]+' · '+stamp(p.at)+' · '+formatted(v)+'</title></circle>';
    }
    flush();
  }
  return '<div class="pf-chart"><h3>'+metricNames[key]+' לאורך זמן</h3>'+(lines?
    '<svg viewBox="0 0 535 110" role="img" aria-label="'+metricNames[key]+' לפי פלטפורמה"><path class="pf-grid" d="M14 14H464 M14 55H464 M14 96H464"/><text x="478" y="18">'+formatted(max)+'</text><text x="478" y="100">0</text>'+lines+'</svg><div class="range"><span>'+stamp(points[0].at)+'</span><span>'+stamp(points.at(-1).at)+'</span></div>':'<p class="caption">טרם התקבלה מדידה.</p>')+'</div>';
}
function performance(r){
  const current=observation(r);
  const points=[...(r.performanceHistory||r.history||[]).filter(p=>p.platforms&&Date.parse(p.at)<Date.parse(current.at)&&(!r.resetAt||Date.parse(p.at)>=Date.parse(r.resetAt))),current];
  const previous=points.at(-2);
  const columns=Object.keys(metricNames);
  const rows=platforms.map(s=>'<tr><th scope="row"><i class="pf-dot '+s+'"></i>'+platformNames[s]+'</th>'+columns.map(k=>'<td>'+formatted(current.platforms[s]?.[k])+(current.platforms[s]?.stale.includes(k)?'<sup aria-label="מדידה קודמת">*</sup>':'')+'</td>').join('')+'</tr>').join('');
  const entries=r.channels.filter(c=>platforms.includes(c.service)).flatMap(c=>c.posts.map(p=>({p,s:c.service,views:postMetric(p,'views')}))).filter(e=>Number.isFinite(e.views)).sort((a,b)=>b.views-a.views);
  const ranked=entries.map(({p,s,views})=>'<li><bdi>'+esc(p.clipTitle||p.text||'סרטון')+'</bdi><small>'+platformNames[s]+' · '+formatted(views)+' צפיות · '+formatted(postMetric(p,'reactions'))+' לייקים</small></li>').join('');
  const missing=platforms.filter(s=>!Number.isFinite(current.platforms[s]?.followers));
  const analysis='<details class="pf-analysis"><summary>✨ ניתוח סרטונים</summary><div><b>הסרטונים לפי מספר צפיות</b>'+(ranked?'<ol>'+ranked+'</ol>':'<p>טרם התקבלו צפיות לניתוח.</p>')+'</div></details>';
  const cards=['views','reactions','followers','videos'].map(k=>kpi(k,current,previous)).join('');
  const freshness=r.channels.filter(c=>current.platforms[c.service]?.stale.length).map(c=>{
    const keys=current.platforms[c.service].stale;
    const times=[...(keys.includes('followers')?[c.followersAt]:[]),...c.posts.flatMap(p=>p.metrics.filter(m=>keys.includes(m.type)).map(m=>m.observedAt))].filter(t=>t&&(!r.runStarted||t<r.runStarted)).sort();
    const expired=c.measurementErrors?.includes('Meta 401/190/463');
    return '<p class="caption">* '+platformNames[c.service]+' · '+(expired?'פג תוקף החיבור. ':'')+'הנתונים המסומנים נשמרו ממדידה קודמת'+(times.length?' ב־'+stamp(times[0]):'')+'.</p>';
  }).join('');
  const note=freshness+(missing.length?'<p class="caption">טרם התקבל מספר עוקבים מ־'+missing.map(s=>platformNames[s]).join(' ומ־')+'.</p>':'');
  const table='<div class="table-wrap"><table aria-label="ביצועים לפי פלטפורמה"><thead><tr><th>פלטפורמה</th>'+Object.values(metricNames).map(v=>'<th>'+v+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table>'+note+'</div>';
  const legend=platforms.map(s=>'<span><i class="pf-dot '+s+'"></i>'+platformNames[s]+'</span>').join('');
  return '<section id="numbers" class="pf">'+analysis+'<h2>המספרים</h2><div class="kpis">'+cards+'</div><p class="caption">'+(previous?'השינוי לעומת העדכון הקודם · ':'')+'מדידה אחרונה '+stamp(current.at)+'</p>'+table+'<details class="fold"><summary>גרפים: צפיות ועוקבים לאורך זמן</summary><div class="inside"><div class="pf-legend">'+legend+'</div>'+chart(points,'views')+chart(points,'followers')+'</div></details></section>';
}

export function renderReport(r){
  const groups=new Map();
  for(const c of r.channels){
    for(const p of c.posts){
      const id=groupKey(p,c.service);
      if(!groups.has(id))groups.set(id,[]);
      groups.get(id).push({...p,service:c.service});
    }
  }
  const production=Array.isArray(r.production)?r.production:[];
  const videos=[...groups.values()].sort((a,b)=>(b[0].sentAt||'').localeCompare(a[0].sentAt||'')).map(posts=>{
    const p=posts[0],track=production.find(t=>t.title===p.clipTitle);
    const links=posts.map(post=>{
      const url=href(post.externalLink,hosts[post.service]||[]);
      const views=post.metrics?.find(m=>m.type==='views'&&Number.isFinite(m.value))?.value;
      const label='<i class="dot '+esc(post.service)+'"></i>'+esc(services[post.service]||post.service)+(views!=null?' · '+formatted(views)+' צפיות':'');
      return url?'<a class="chip" target="_blank" rel="noopener noreferrer" href="'+url+'">'+label+'</a>':'<span class="chip">'+label+'</span>';
    }).join('')+r.channels.filter(c=>!posts.some(post=>post.service===c.service)).flatMap(c=>
      (c.deliveries||[]).filter(d=>d.clipId===p.clipId).map(d=>'<span class="chip">'+esc(services[c.service])+' · '+
        (d.status==='SEND_TO_USER_INBOX'?'טיוטה באפליקציה':d.status==='PUBLISH_COMPLETE'?'ממתין לקישור ציבורי':'בבדיקה')+'</span>')
    ).join('');
    return '<article class="release"><strong><bdi>'+esc(p.clipTitle||p.text||'סרטון')+'</bdi></strong><div class="caption">'+[track?.language,track?.format,stamp(p.sentAt)].filter(Boolean).map(esc).join(' · ')+'</div><div class="release-links">'+links+'</div></article>';
  }).join('');
  return performance(r)+'<section id="published"><details id="publishedFold" class="list-fold"><summary><h2>סרטונים שפורסמו <span class="count">'+groups.size+'</span></h2></summary><div class="release-list">'+(videos||'<p class="caption">עדיין אין סרטונים שפורסמו.</p>')+'</div></details></section>';
}
