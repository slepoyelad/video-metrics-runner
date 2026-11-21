import { readFile, writeFile } from 'node:fs/promises';
import { enrichPublicMetrics } from './public-metrics.mjs';
import { readInsights } from './insights.mjs';

const directory=new URL('../data/',import.meta.url);
const file=name=>new URL(name,directory);
const previous=JSON.parse(await readFile(file('report.json'),'utf8'));
const started=new Date().toISOString();
let snapshot=structuredClone(previous);
if(process.env.BUFFER_READ_KEY){
  try{
    const accounts=JSON.parse(await readFile(file('accounts.json'),'utf8'));
    const fresh=await readInsights(async(query,variables)=>{
      const response=await fetch('https://api.buffer.com',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
        headers:{authorization:'Bearer '+process.env.BUFFER_READ_KEY,'content-type':'application/json'},body:JSON.stringify({query,variables})});
      if(!response.ok)throw Error('Buffer unavailable');
      const result=await response.json();
      if(result.errors||!result.data)throw Error('Buffer unavailable');
      return result.data;
    },accounts);
    for(const ch of fresh.channels){
      const prior=previous.channels.find(c=>c.service===ch.service);
      if(!ch.connected&&prior){Object.assign(ch,prior);continue;}
      for(const p of ch.posts){
        const old=prior?.posts.find(o=>o.id===p.id);
        if(old)Object.assign(p,{clipId:old.clipId,clipTitle:old.clipTitle});
      }
    }
    snapshot=fresh;
  }catch{/* Preserve the known post catalog on a provider failure. */}
}
await enrichPublicMetrics(snapshot,previous,process.env.INSTAGRAM_INSIGHTS_TOKEN,process.env.FACEBOOK_INSIGHTS_TOKEN);
const youtube=snapshot.channels.find(c=>c.service==='youtube');
if(process.env.YOUTUBE_API_KEY&&youtube){
  const ids=new Map();
  for(const p of youtube.posts){
    try{
      const u=new URL(p.externalLink),id=u.searchParams.get('v')||u.pathname.split('/').filter(Boolean).at(-1);
      if(/^[\w-]{11}$/.test(id))ids.set(id,p);
    }catch{}
  }
  const keys=[...ids.keys()];
  for(let i=0;i<keys.length;i+=50){
    try{
      const u=new URL('https://www.googleapis.com/youtube/v3/videos');
      u.search=new URLSearchParams({part:'statistics',id:keys.slice(i,i+50).join(',')});
      const r=await fetch(u,{headers:{'X-Goog-Api-Key':process.env.YOUTUBE_API_KEY},redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!r.ok)continue;
      for(const item of (await r.json()).items||[]){
        const p=ids.get(item.id);
        if(!p)continue;
        for(const [type,key] of Object.entries({views:'viewCount',reactions:'likeCount',comments:'commentCount'})){
          const raw=item.statistics?.[key];
          if(typeof raw!=='string'||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))continue;
          p.metrics=p.metrics.filter(m=>m.type!==type);
          p.metrics.push({type,value:Number(raw),source:'public',observedAt:new Date().toISOString()});
        }
      }
    }catch{}
  }
}
snapshot.fetchedAt=new Date().toISOString();
snapshot.runStarted=started;
snapshot.requestId=process.env.REQUEST_ID||'';
snapshot.runId=process.env.GITHUB_RUN_ID||'';
const labels={instagram:'Instagram',youtube:'YouTube',tiktok:'TikTok'};
const fmt=s=>s?new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',dateStyle:'short',timeStyle:'short'}).format(new Date(s)):'—';
const rows=['# ביצועי הסרטונים','','[רענון הנתונים ב־GitHub]('+process.env.WORKFLOW_URL+')','','בדיקה אחרונה · '+fmt(snapshot.fetchedAt)+' (ישראל)','','| פלטפורמה | סרטון | צפיות | לייקים | תגובות |','| --- | --- | --- | --- | --- |'];
for(const c of snapshot.channels){
  for(const p of c.posts){
    const u=URL.canParse(p.externalLink)?new URL(p.externalLink):null;
    const link=u?.protocol==='https:'?'[פתיחה](<'+u.href.replace(/[<>]/g,'')+'>)':'—';
    const entries=['views','reactions','comments'].map(k=>{
      const m=p.metrics?.find(v=>v.type===k);
      if(!Number.isFinite(m?.value))return '—';
      const at=m.observedAt||p.metricsUpdatedAt;
      const origin=c.service==='instagram'&&k==='views'?(m.source==='public'?' · נגן מוטמע':m.source==='instagram-insights'?' · Instagram Insights':' · Buffer'):'';
      return m.value+origin+' · '+fmt(at);
    });
    rows.push('| '+[labels[c.service],link,...entries].join(' | ')+' |');
  }
}
rows.push('','השעה ליד כל מונה היא שעת המדידה. מקף מציין נתון שטרם התקבל.','');
await writeFile(file('report.json'),JSON.stringify(snapshot,null,2)+'\n');
await writeFile(file('README.md'),rows.join('\n'));
