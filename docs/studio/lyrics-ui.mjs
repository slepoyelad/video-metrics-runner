export function openLyrics(item,cost,submit){
  const draft=item.lyricDraft;
  if(!draft)return;
  const dialog=document.createElement('dialog');
  dialog.className='lyrics-dialog';
  function add(tag,text){
    const el=document.createElement(tag);el.textContent=text;dialog.append(el);return el;
  }
  add('h2','שכתוב מילים');
  const title=add('strong',item.title);title.dir='auto';
  add('p',({ready:'טיוטה לקריאה ולאישור',writing:'הדגשים אצל Codex · השכתוב בהכנה',recorded:'מילים שאושרו והוקלטו',producing:'הטיוטה אושרה ונשלחה להפקה',original:'המילים של הביצוע הנוכחי',error:'השכתוב דורש ניסיון נוסף'})[draft.state]);
  const text=add('div',draft.lyrics);text.dir='auto';
  text.className='lyric-sheet';
  if(draft.message)add('p',draft.message);
  if(draft.note)add('p','הדגש האחרון · '+draft.note);
  const label=add('label','מה לשנות במילים או בסדר השיחה?');
  const note=document.createElement('textarea');note.rows=3;note.maxLength=800;note.dir='auto';label.append(note);
  const msg=add('p','');msg.setAttribute('role','status');
  const rewrite=add('button','שליחת דגשים ל־Codex');
  const approve=draft.state==='ready'?add('button','אישור המילים והפקה ב־Suno · '+cost+' קרדיטים'):null;
  const close=add('button','סגירה');close.onclick=()=>dialog.close();
  const locked=item.rerunPending||item.runsPending||['writing','producing'].includes(draft.state);
  rewrite.disabled=!!locked;if(approve)approve.disabled=!!locked;
  async function send(action){
    if(action==='rewrite'&&!note.value.trim()){msg.textContent='יש לכתוב דגש לשכתוב.';note.focus();return;}
    rewrite.disabled=true;if(approve)approve.disabled=true;
    msg.textContent='שומר את הבקשה…';
    try{await submit(action,draft.id,action==='rewrite'?note.value.trim():'');dialog.close();}
    catch(e){msg.textContent=e.message;rewrite.disabled=!!locked;if(approve)approve.disabled=!!locked;}
  }
  rewrite.onclick=()=>send('rewrite');if(approve)approve.onclick=()=>send('produce');
  document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();
}


export function renderTakes(versions, renderTake){
  const groups=new Map();
  for(const version of versions){
    const match=/(?:^| · )הרצה (\d+) · (.+)$/.exec(version.label||'');
    const run=match?.[1]||'';
    if(!groups.has(run))groups.set(run,[]);
    groups.get(run).push({version,label:match?.[2]||version.label||'הקלטה'});
  }
  const panel=document.createElement('div');
  panel.className='suno-takes';
  const history=document.createElement('details');
  const summary=document.createElement('summary');
  history.append(summary);
  let older=0;
  for(const [run,takes] of groups){
    const latest=panel.childElementCount===0;
    const section=document.createElement('section');
    const heading=document.createElement('strong');
    heading.textContent=latest?'הביצועים האחרונים':run?'הרצה '+run:'הקלטות ראשונות';
    section.append(heading);
    for(const {version,label} of takes){
      const line=document.createElement('div');
      line.className='suno-take';
      const name=document.createElement('span');
      name.textContent=label;
      line.append(name,renderTake(version));
      section.append(line);
    }
    if(latest)panel.append(section);
    else{history.append(section);older+=takes.length;}
  }
  if(older){
    summary.textContent='הקלטות קודמות ('+older+')';
    panel.append(history);
  }
  return panel;
}
