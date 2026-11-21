const listPosts = `query($org:OrganizationId!, $channels:[ChannelId!]!, $cursor:String){
  posts(input:{organizationId:$org,filter:{channelIds:$channels,status:[sent]}},first:50,after:$cursor){
    edges{node{id channelId text sentAt externalLink metricsUpdatedAt metrics{type name unit value}}}
    pageInfo{hasNextPage endCursor}
  }
}`;

export async function readInsights(api,accounts) {
  const {account} = await api('{account{organizations{id}}}');
  const reports = accounts.map(channel=>({...channel, connected:false, posts:[]}));
  const seen = new Set();
  for(const org of account.organizations) {
    const {channels} = await api('query($org:OrganizationId!){channels(input:{organizationId:$org}){id displayName name}}',{org:org.id});
    const selected = reports.filter(report=>channels.some(ch=>ch.id===report.id));
    if(!selected.length)continue;
    for(const report of selected){
      const channel = channels.find(ch=>ch.id===report.id);
      report.connected = true;
      report.label = channel.displayName || channel.name || report.label;
    }
    let cursor = null;
    do {
      const {posts} = await api(listPosts,{org:org.id,channels:selected.map(ch=>ch.id),cursor});
      for(const {node} of posts.edges){
        const report = selected.find(ch=>ch.id===node.channelId);
        if(report && !seen.has(node.id)){
          report.posts.push(node);
          seen.add(node.id);
        }
      }
      if(posts.pageInfo.hasNextPage && (!posts.pageInfo.endCursor || posts.pageInfo.endCursor===cursor))
        throw Error('Buffer לא השלים את רשימת הפוסטים.');
      cursor = posts.pageInfo.hasNextPage ? posts.pageInfo.endCursor : null;
    } while(cursor);
  }
  for(const report of reports)report.posts.sort((a,b)=>(b.sentAt||'').localeCompare(a.sentAt||''));
  return {fetchedAt:new Date().toISOString(), channels:reports};
}

