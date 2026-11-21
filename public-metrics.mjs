// Read only the counters on the linked public post. No credentials or redirects.
function exactCount(value) {
  if(typeof value==='string'){
    if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value))return null;
    value=Number(value.replaceAll(',',''));
  }
  return Number.isSafeInteger(value)&&value>=0 ? value : null;
}

function embeddedJson(html,prefix) {
  const start=html.indexOf(prefix);
  if(start<0)return null;
  const end=html.indexOf('</script>',start);
  if(end<0)return null;
  return JSON.parse(html.slice(start+prefix.length,end).trim().replace(/;$/,''));
}

function findField(node,key) {
  if(!node||typeof node!=='object')return;
  if(Object.hasOwn(node,key))return node[key];
  for(const child of Object.values(node)){
    const value=findField(child,key);
    if(value!==undefined)return value;
  }
}

function youtube(html,id) {
  const video=embeddedJson(html,'var ytInitialPlayerResponse = ')?.videoDetails;
  if(video?.videoId!==id)return {};
  const result={views:video.viewCount};
  const content=embeddedJson(html,'var ytInitialData = ')?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
  const actions=content?.find(row=>row.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer?.videoActions;
  const like=findField(actions,'likeButtonViewModel');
  if(like){
    const label=findField(like,'accessibilityText')||'';
    result.reactions=label.match(/like this video along with ([\d,]+) other (?:people|person)/i)?.[1] ?? findField(like,'title');
  }
  const header=findField(content,'commentsHeaderRenderer');
  const count=(header?.countText?.runs||[]).map(r=>r.text).join('').match(/(?:^|\s)([\d,]+)(?:\s|$)/);
  if(count)result.comments=count[1];
  return result;
}

function instagram(html,id) {
  const canonical=html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.instagram\.com\/reel\/([\w-]+)\/?"/i);
  if(canonical?.[1]!==id)return {};
  const description=html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i)?.[1]||'';
  const counts=description.match(/^([\d,]+) likes?,\s*([\d,]+) comments?\s*-/i);
  return counts ? {reactions:counts[1],comments:counts[2]} : {};
}
function youtubeShort(html,id){
  const player=embeddedJson(html,'var ytInitialPlayerResponse = ');
  const canonical=html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/shorts\/([\w-]+)"/);
  if(canonical?.[1]!==id||player?.videoDetails?.videoId!==id)return {};
  const bar=embeddedJson(html,'var ytInitialData = ')?.overlay?.reelPlayerOverlayRenderer?.playerOverlay?.reelPlayerOverlayViewModel?.actionBar?.reelActionBarViewModel;
  const buttons=bar?.buttonViewModels||[];
  const comment=buttons.find(b=>b.buttonViewModel?.iconName==='SHORTS_COMMENT')?.buttonViewModel;
  const likes=buttons.find(b=>b.likeButtonViewModel)?.likeButtonViewModel;
  const label=likes?findField(likes,'accessibilityText'):'';
  return {views:player.videoDetails.viewCount??player.microformat?.playerMicroformatRenderer?.viewCount,
    comments:comment?.accessibilityText?.match(/^View ([\d,]+) comments?$/i)?.[1]??comment?.title,
    reactions:label?.match(/like this video along with ([\d,]+) other (?:people|person)/i)?.[1]};
}

function instagramEmbed(html,id){
  // Instagram's embed serializes its media object inside a JSON string.
  for(const match of html.matchAll(/"(?:[^"\\]|\\.)*"/g)){
    if(!match[0].includes('shortcode_media')||!match[0].includes('video_view_count'))continue;
    try{
      const data=JSON.parse(JSON.parse(match[0]));
      const media=findField(data,'shortcode_media');
      if(media?.shortcode===id)return {views:media.video_view_count,reactions:media.edge_media_preview_like?.count??media.edge_liked_by?.count,comments:media.edge_media_to_comment?.count??media.edge_media_to_parent_comment?.count};
    }catch{}
  }
  return {};
}

function tiktok(html,id) {
  const marker=html.match(/<script\b[^>]*\bid="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>/)?.[0];
  if(!marker)return {};
  const item=embeddedJson(html,marker)?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
  if(item?.id!==id)return {};
  const stats=item.statsV2||item.stats||{};
  return {views:stats.playCount,reactions:stats.diggCount,comments:stats.commentCount,shares:stats.shareCount,saves:stats.collectCount};
}

async function counters(service,link) {
  if(!link)return {};
  const url=new URL(link);
  if(url.protocol!=='https:')return {};
  let id,target,parse;
  if(service==='youtube'&&['youtube.com','www.youtube.com','youtu.be'].includes(url.hostname)){
    id=url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.split('/').filter(Boolean).at(-1);
    if(!/^[\w-]{11}$/.test(id||''))return {};
    target='https://www.youtube.com/watch?v='+id;parse=youtube;
  }else if(service==='instagram'&&['instagram.com','www.instagram.com'].includes(url.hostname)){
    id=url.pathname.match(/\/reel\/([\w-]+)\/?$/)?.[1];if(!id)return {};
    target='https://www.instagram.com/reel/'+id+'/';parse=instagram;
  }else if(service==='tiktok'&&['tiktok.com','www.tiktok.com'].includes(url.hostname)){
    const match=url.pathname.match(/^\/@([\w.-]+)\/video\/(\d+)\/?$/);if(!match)return {};
    id=match[2];target='https://www.tiktok.com/@'+match[1]+'/video/'+id;parse=tiktok;
  }else return {};
  async function read(url,decoder){
    try{
      const res=await fetch(url,{headers:{'Accept-Language':'en-US'},redirect:'error',signal:AbortSignal.timeout(9000)});
      if(res.ok&&res.headers.get('content-type')?.includes('text/html'))return decoder(await res.text(),id);
    }catch{}
    return {};
  }
  if(service==='instagram'){
    const [page,embed]=await Promise.all([read(target,parse),read(target+'embed/captioned/',instagramEmbed)]);
    return {...page,...Object.fromEntries(Object.entries(embed).filter(([,v])=>v!=null))};
  }
  if(service==='youtube'&&url.pathname.startsWith('/shorts/')){
    const [watch,short]=await Promise.all([read(target,parse),read('https://www.youtube.com/shorts/'+id,youtubeShort)]);
    return {...watch,...Object.fromEntries(Object.entries(short).filter(([,v])=>exactCount(v)!==null))};
  }
  return read(target,parse);
}

// Match by permalink: the shortcode in a public URL is not a Graph media ID.
async function instagramOwnerViews(channel,token,viaFacebook,accountId){
  const pending=new Map();
  for(const p of channel.posts){
    try{
      const u=new URL(p.externalLink);
      const code=u.pathname.match(/^\/(?:reel|p)\/([\w-]+)\/?$/)?.[1];
      if(code&&['instagram.com','www.instagram.com'].includes(u.hostname))pending.set(code,p);
    }catch{}
  }
  const json=async(path,params)=>{
    const origin=viaFacebook?'https://graph.facebook.com':'https://graph.instagram.com';
    const url=new URL('/v24.0/'+path,origin);
    url.search=new URLSearchParams(params);
    const res=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(6000)});
    if(!res.ok){
      const body=await res.json().catch(()=>({}));
      throw Object.assign(Error('Instagram Insights unavailable'),{reason:{
        step:path==='me/accounts'?'pages':path.endsWith('/media')?'media':path.endsWith('/insights')?'insights':'account',
        status:res.status,code:Number(body.error?.code)||null,subcode:Number(body.error?.error_subcode)||null
      }});
    }
    return res.json();
  };
  let owner='me';
  if(viaFacebook){
    const handle=channel.label.replace(/^@/,'').toLowerCase();
    let cursor='';
    do{
      const list=await json('me/accounts',{fields:'instagram_business_account{id,username}',limit:'100',...(cursor?{after:cursor}:{})});
      const account=list.data?.map(p=>p.instagram_business_account).find(a=>a?.username?.toLowerCase()===handle);
      if(account&&/^\d+$/.test(account.id)){owner=account.id;break;}
      const next=list.paging?.cursors?.after;
      if(!list.paging?.next||!next||cursor===next){
        if(/^\d+$/.test(accountId||'')){
          const linked=await json(accountId,{fields:'id,username'});
          if(linked.id===accountId&&linked.username?.toLowerCase()===handle){owner=accountId;break;}
        }
        channel.ownerCheck={step:'account-not-found'};return;
      }
      cursor=next;
    }while(cursor);
  }
  let after='';
  for(let page=0;page<5&&pending.size;page++){
    const list=await json(owner+'/media',{fields:'id,permalink',limit:'100',...(after?{after}:{})});
    for(const media of list.data||[]){
      const code=media.permalink?.match(/\/(?:reel|p)\/([\w-]+)\/?$/)?.[1];
      const post=pending.get(code);
      if(!post||!/^\d+$/.test(media.id))continue;
      pending.delete(code);
      try{
        const result=await json(media.id+'/insights',{metric:'views'});
        const metric=result.data?.find(m=>m.name==='views');
        const value=exactCount(metric?.values?.[0]?.value??metric?.total_value?.value);
        if(value===null){channel.ownerCheck={step:'no-view-value'};continue;}
        post.metrics=post.metrics.filter(m=>m.type!=='views');
        post.metrics.push({type:'views',name:'views',unit:'count',value,source:'instagram-insights',observedAt:new Date().toISOString()});
      }catch(error){channel.ownerCheck=error.reason||{step:'insights-unavailable'};}
    }
    const cursor=list.paging?.cursors?.after;
    if(!list.paging?.next||!cursor||cursor===after)break;
    after=cursor;
  }
  if(pending.size&&!channel.ownerCheck)channel.ownerCheck={step:'reel-not-found'};
}

export async function enrichPublicMetrics(snapshot, previous, instagramToken, facebookToken, accountId) {
  const ownerToken=facebookToken||instagramToken;
  const old=new Map((previous?.channels||[]).flatMap(c=>c.posts.map(p=>[p.id,p])));
  await Promise.all(snapshot.channels.map(async channel=>{
    for(const [index,p] of channel.posts.entries()){
      // Buffer can return placeholder zeros dated before the post was published.
      const bufferTime=Date.parse(p.metricsUpdatedAt);
      const metrics=new Map((bufferTime<Date.parse(p.sentAt)?[]:p.metrics||[]).map(m=>[m.type,m]));
      for(const m of old.get(p.id)?.metrics||[]){
        if(m.source==='public' && (!metrics.has(m.type)||!Number.isFinite(bufferTime)||Date.parse(m.observedAt)>bufferTime))
          metrics.set(m.type,m);
      }
      if(index<5){
        let publicValues={};
        try{publicValues=await counters(channel.service,p.externalLink);}catch{/* Keep the most recent available values on a timeout, denial or markup change. */}
        const observedAt=new Date().toISOString();
        p.publicAvailable=false;
        for(const [type,raw] of Object.entries(publicValues)){
          const value=exactCount(raw);
          if(value!==null){
            metrics.set(type,{type,name:type,unit:'count',value,source:'public',observedAt});
            p.publicAvailable=true;
          }
        }
      }
      p.metrics=[...metrics.values()];
      if(channel.service==='instagram'&&ownerToken){
        const saved=old.get(p.id)?.metrics?.find(m=>m.type==='views'&&m.source==='instagram-insights');
        if(saved)p.metrics=[...p.metrics.filter(m=>m.type!=='views'),saved];
      }
    }
    if(channel.service==='instagram'&&ownerToken){
      delete channel.ownerCheck;
      try{await instagramOwnerViews(channel,ownerToken,Boolean(facebookToken),accountId);}
      catch(error){channel.ownerCheck=error.reason||{step:'request-unavailable'};}
    }
  }));
  snapshot.fetchedAt=new Date().toISOString();
  return snapshot;
}
