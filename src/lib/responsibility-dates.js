// Calendar recurrence: clamp monthly dates, and always advance an elapsed deadline.
export function followingDate(deadline,term,days) {
    const date=new Date(deadline);
    if(!Number.isFinite(+date)) throw new Error('Fecha inválida.');
    const result=new Date(date);
    if(term==='daily'||term==='weekly'||term==='every x days') {
        const step=term==='daily'?1:term==='weekly'?7:Number(days);
        if(!Number.isInteger(step)||step<=0) throw new Error('La frecuencia debe tener días positivos.');
        result.setDate(date.getDate()+step);return result;
    }
    if(term==='biweekly') {
        const y=date.getFullYear(),m=date.getMonth(),d=date.getDate(),last=new Date(y,m+1,0).getDate();
        if(d<15) result.setDate(15);
        else if(d<last) result.setDate(last);
        else {result.setDate(1);result.setMonth(m+1);result.setDate(15);}
        return result;
    }
    const months={monthly:1,bimonthly:2,quarterly:3,biannual:6,yearly:12}[term];
    if(!months) throw new Error('Frecuencia no reconocida.');
    result.setDate(1);result.setMonth(date.getMonth()+months);
    result.setDate(Math.min(date.getDate(),new Date(result.getFullYear(),result.getMonth()+1,0).getDate()));
    return result;
}
export function initialDate(deadline,term,days,now=new Date()) {
    const date=new Date(deadline),today=new Date(now);today.setHours(0,0,0,0);
    if(term==='biweekly' && date>today) {
        const result=new Date(date),day=date.getDate();
        result.setDate(day<=15?15:new Date(date.getFullYear(),date.getMonth()+1,0).getDate());
        return result;
    }
    if(date>today) return date;
    return followingDate(date,term,days);
}
