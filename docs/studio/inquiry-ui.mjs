export function showInquiry(row,info,send,waiting=false){
  if(!info)return;
  const box=document.createElement('div'),message=document.createElement('p');
  message.className='fine';message.setAttribute('role','status');box.append(message);row.append(box);
  const labels={queued:'הבקשה התקבלה וממתינה לבירור ב־Codex.',checking:'Codex בודק את התקלה…',done:'תשובת Codex'};
  message.textContent=waiting?'הבקשה נשמרה וממתינה לסנכרון עם המחשב.':labels[info.state]||'';
  if(info.result){const text=document.createElement('p');text.textContent=info.result;box.append(text);}
  if(waiting||!['new','failed'].includes(info.state))return;
  const button=document.createElement('button');button.type='button';
  button.textContent=info.state==='failed'?'לשלוח שוב ל־Codex':'שליחה ל־Codex לבירור';
  box.append(button);
  button.onclick=async()=>{
    button.disabled=true;message.textContent='שולח את פרטי התקלה…';
    try{message.textContent=await send();}
    catch(e){button.disabled=false;message.textContent=e.message;}
  };
}
