const {test,expect}=require('@playwright/test');
const {login,query}=require('../helpers/app');
const {post,unique}=require('../helpers/audit');
const {followingDate}=require('esm')(module)('../../src/lib/responsibility-dates');
for(const [date,term,days,expected] of [['2026-01-14','daily',null,'2026-01-15'],['2026-01-14','weekly',null,'2026-01-21'],['2026-01-14','biweekly',null,'2026-01-15'],['2026-01-15','biweekly',null,'2026-01-31'],['2026-01-31','biweekly',null,'2026-02-15'],['2026-01-31','monthly',null,'2026-02-28'],['2024-02-29','yearly',null,'2025-02-28'],['2026-01-31','bimonthly',null,'2026-03-31'],['2026-01-31','quarterly',null,'2026-04-30'],['2026-01-31','biannual',null,'2026-07-31'],['2026-01-31','every x days',3,'2026-02-03']])test('recurrencia '+date+' '+term,()=>{
 expect(followingDate(date+'T12:00:00Z',term,days).toISOString().slice(0,10)).toBe(expected);
});
async function assigned(request,times=2,user=201){
 await login(request);const name=unique('Responsabilidad');
 const created=await post(request,'new_recurrent_responsibility',{name,description:'Revisar herramientas',importance:75,time_frequency:{id_time_frequency:1}});
 const definitions=await (await request.get('/api/public/responsibilitys')).json();
 const responsibility=definitions.responsibilitys.find(r=>r.id_recurrent_responsibility===created.data.id_recurrent_responsibility);expect(responsibility.name).toBe(name);
 const assignment=await post(request,'assign_responsibility',{responsibility,user:{value:user},deadline:'2030-01-10',times_remaining:times});
 return {responsibility,pending:assignment.data};
}
test('crear, asignar, enviar, rechazar, reenviar y aprobar conserva autoría y evidencia',async({request})=>{
 const {responsibility,pending}=await assigned(request);
 const active=await (await request.get('/api/public/active_responsibilitys')).json();expect(active.active_responsibilitys.some(r=>r.id_active_responsibility===pending.id_active_responsibility)).toBe(true);
 await login(request,'test-user-201');
 let list=await (await request.get('/api/public/pending_responsibilitys')).json();expect(list.pending_responsibilitys.some(r=>r.id_pending_responsibility===pending.id_pending_responsibility)).toBe(true);
 const first=await post(request,'new_awaiting_approval_responsibility',{id_pending_responsibility:pending.id_pending_responsibility,description_evidence:'Evidencia original'});
 expect((await request.post('/api/public/new_awaiting_approval_responsibility',{data:{id_pending_responsibility:pending.id_pending_responsibility,description_evidence:'Duplicada'}})).status()).toBe(409);
 list=await (await request.get('/api/public/pending_responsibilitys')).json();expect(list.pending_responsibilitys.some(r=>r.id_pending_responsibility===pending.id_pending_responsibility)).toBe(false);
 await login(request);const review=await (await request.get('/api/public/all_awaiting_approval_responsibilitys')).json();expect(review.awaiting_approval_responsibilitys.some(r=>r.id_pending_responsibility===pending.id_pending_responsibility)).toBe(true);
 await post(request,'rejected_responsibility',{id_awaiting_approval_responsibility:first.awaiting_approval_responsibilitys[0].id_awaiting_approval_responsibility});
 await login(request,'test-user-201');const second=await post(request,'new_awaiting_approval_responsibility',{id_pending_responsibility:pending.id_pending_responsibility,description_evidence:'Evidencia corregida'});
 await login(request);const data={...second.awaiting_approval_responsibilitys[0],id_user_who_made:204,id_recurrent_responsibility:responsibility.id_recurrent_responsibility,description_evidence:'Falsificada',created_at:'2000-01-01'};
 const approved=await post(request,'new_approved_responsibility',data);expect(approved.completed_responsibility).toMatchObject({id_user_who_made:201,id_user_who_approved:1,description_evidence:'Evidencia corregida'});
 expect((await request.post('/api/public/new_approved_responsibility',{data})).status()).toBe(409);
 const next=await query('SELECT * FROM pending_responsibilitys WHERE id_active_responsibility=$1',[pending.id_active_responsibility]);expect(next.length).toBe(1);expect(+new Date(next[0].deadline)).toBeGreaterThan(+new Date(pending.deadline));
});
test('otra persona no puede enviar evidencia de una responsabilidad ajena',async({request})=>{
 const {pending}=await assigned(request,1);await login(request,'test-user-204');
 expect((await request.post('/api/public/new_awaiting_approval_responsibility',{data:{id_pending_responsibility:pending.id_pending_responsibility,description_evidence:'Ajena'}})).status()).toBe(403);
});
test('actualización concurrente genera una sola siguiente entrega y respeta el número de repeticiones',async({request})=>{
 const {pending}=await assigned(request,2);await query("UPDATE pending_responsibilitys SET deadline='2020-01-01' WHERE id_pending_responsibility=$1",[pending.id_pending_responsibility]);
 await Promise.all([1,2].map(()=>post(request,'update_responsibility',{responsibility:pending})));
 const all=await query('SELECT * FROM pending_responsibilitys WHERE id_active_responsibility=$1 ORDER BY deadline',[pending.id_active_responsibility]);expect(all.length).toBe(2);
 await post(request,'update_responsibility',{responsibility:all[1]});expect((await query('SELECT * FROM pending_responsibilitys WHERE id_active_responsibility=$1',[pending.id_active_responsibility])).length).toBe(2);
 expect((await query('SELECT times_remaining FROM active_responsibilitys WHERE id_active_responsibility=$1',[pending.id_active_responsibility]))[0].times_remaining).toBe(1);
});
