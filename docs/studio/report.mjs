const labels={views:'צפיות',reactions:'לייקים',comments:'תגובות',videos:'סרטונים שפורסמו'};
const services={instagram:'אינסטגרם',youtube:'יוטיוב',tiktok:'טיקטוק'};
const hosts={instagram:['www.instagram.com','instagram.com'],youtube:['youtube.com','www.youtube.com','youtu.be'],tiktok:['tiktok.com','www.tiktok.com']};
const number=new Intl.NumberFormat('he-IL');
export const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const stamp=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—';
function href(value,allowed){
  try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&allowed.includes(u.hostname))return esc(u.href);}catch{}
  return '';
}
const formatted=value=>Number.isFinite(value)?number.format(value):'—';
const totalsKeys=['views','reactions','comments'];
function groupKey(p,service){return p.clipId||service+'/'+p.id;}
function measure(c,key,resetAt){
  if(resetAt&&!c.posts.length&&!c.deliveries?.length&&!c.measurementErrors?.length)return {value:0,count:0,sources:[]};
  const samples=c.posts.flatMap(p=>{
    const m=p.metrics?.find(m=>m.type===key&&Number.isFinite(m.value));
    return m?[{value:m.value,at:m.observedAt||p.metricsUpdatedAt,source:m.source}]:[];
  });
  return {value:samples.length?samples.reduce((n,m)=>n+m.value,0):null,count:samples.length,
    time:samples.map(m=>m.at).filter(Boolean).sort()[0],sources:[...new Set(samples.map(m=>m.source))]};
}
export function observation(report){
  const channels=report.channels||[], posts=channels.flatMap(c=>c.posts.map(p=>groupKey(p,c.service)));
  const item={at:report.fetchedAt,videos:new Set(posts).size,coverage:{}};
  for(const key of totalsKeys){
    const rows=channels.map(c=>measure(c,key,report.resetAt));
    const count=rows.reduce((n,m)=>n+m.count,0);
    const resetEmpty=!!report.resetAt&&channels.length>0&&posts.length===0;
    item[key]=count||resetEmpty?rows.reduce((n,m)=>n+(m.value??0),0):null;
    item.coverage[key]=count===posts.length&&(count>0||resetEmpty);
  }
  return item;
}
function badgeDelta(current,old,key){
  if(!old||!Number.isFinite(old[key])||!Number.isFinite(current[key]))return '';
  if(key!=='videos'&&(!current.coverage[key]||!old.coverage?.[key]))return '';
  const delta=current[key]-old[key];
  return '<small class="change '+(delta>0?'up':delta<0?'down':'same')+'">'+(delta===0?'ללא שינוי':'<bdi>'+(delta>0?'+':'')+formatted(delta)+'</bdi>')+'</small>';
}
function metricCell(c,key,r){
  const m=measure(c,key,r.resetAt);
  const notes=[];
  if(key==='views'&&c.service==='instagram'&&m.count){
    notes.push(m.sources.map(s=>s==='instagram-insights'?'Instagram Insights':s==='public'?'נגן מוטמע':'Buffer').join(' / '));
  }
  if(m.count&&m.count<c.posts.length)notes.push(m.count+' מתוך '+c.posts.length);
  if(m.time)notes.push(stamp(m.time));
  if(m.count&&r.runStarted&&m.time<r.runStarted)notes.push('מדידה קודמת');
  return '<td><strong>'+formatted(m.value)+'</strong>'+notes.map(n=>'<small>'+esc(n)+'</small>').join('')+'</td>';
}
function trend(points){
  if(points.length<2)return '';
  const values=points.filter(p=>Number.isFinite(p.views)&&p.coverage?.views);
  if(values.length<2)return '';
  const lo=Math.min(...values.map(p=>p.views)),hi=Math.max(...values.map(p=>p.views));
  const t0=Date.parse(values[0].at),span=Math.max(1,Date.parse(values.at(-1).at)-t0);
  const coordinates=values.map(p=>[(4+592*(Date.parse(p.at)-t0)/span).toFixed(1),(hi===lo?44:81-74*(p.views-lo)/(hi-lo)).toFixed(1)].join(',')).join(' ');
  return '<details class="fold"><summary>צפיות לאורך זמן</summary><div class="inside"><svg class="trend" viewBox="0 0 600 88" role="img" aria-label="מגמת הצפיות"><polyline points="'+coordinates+'" fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke"/></svg><div class="range"><span>'+stamp(values[0].at)+' · '+formatted(values[0].views)+'</span><span>'+stamp(values.at(-1).at)+' · '+formatted(values.at(-1).views)+'</span></div></div></details>';
}
export function renderReport(r){
  const current=observation(r);
  const points=[...(r.history||[]).filter(p=>Number.isFinite(Date.parse(p.at))&&p.at<current.at),current];
  const groups=new Map();
  for(const c of r.channels){
    for(const p of c.posts){
      const id=groupKey(p,c.service);
      if(!groups.has(id))groups.set(id,[]);
      groups.get(id).push({...p,service:c.service});
    }
  }
  const kpis=Object.entries(labels).map(([k,l])=>'<article class="kpi"><strong>'+formatted(current[k])+'</strong><span>'+l+'</span>'+badgeDelta(current,points.at(-2),k)+(k!=='videos'&&current[k]!=null&&!current.coverage[k]?'<small>נתונים חלקיים</small>':'')+'</article>').join('');
  const rows=r.channels.map(c=>'<tr><th scope="row"><i class="dot '+esc(c.service)+'"></i>'+esc(services[c.service]||c.service)+'<small dir="ltr">@'+esc(c.label)+'</small></th>'+totalsKeys.map(k=>metricCell(c,k,r)).join('')+'</tr>').join('');
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
  return '<section id="numbers"><h2>המספרים</h2><div class="kpis">'+kpis+'</div>'+(points.length>1?'<p class="caption">שינוי מהבדיקה ב־'+stamp(points.at(-2).at)+'</p>':'')+'<div class="table-wrap"><table><caption>ביצועים לפי פלטפורמה</caption><thead><tr><th>פלטפורמה</th>'+totalsKeys.map(k=>'<th>'+labels[k]+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+trend(points)+'</section><section id="published"><details id="publishedFold" class="list-fold"><summary><h2>סרטונים שפורסמו <span class="count">'+groups.size+'</span></h2></summary><div class="release-list">'+(videos||'<p class="caption">עדיין אין סרטונים שפורסמו.</p>')+'</div></details></section>';
}
