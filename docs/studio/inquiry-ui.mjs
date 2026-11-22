export function showInquiry(row,info,send,waiting=false){
  if(!info)return;
  const box=document.createElement('div'),message=document.createElement('p');
  message.className='fine';message.setAttribute('role','status');box.append(message);row.append(box);
  const labels={queued:'ממתין לתיקון אוטומטי.',checking:'מתקן את ההפקה…'};
  message.textContent=waiting?'הבקשה נשמרה וממתינה לסנכרון עם המחשב.':labels[info.state]||'';
  if(waiting||!['new','failed'].includes(info.state))return;
  const button=document.createElement('button');button.type='button';
  button.textContent='תיקון אוטומטי ובדיקה מחדש';
  box.append(button);
  button.onclick=async()=>{
    button.disabled=true;message.textContent='מכניס את ההפקה לתור התיקונים…';
    try{message.textContent=await send();}
    catch(e){button.disabled=false;message.textContent=e.message;}
  };
}
