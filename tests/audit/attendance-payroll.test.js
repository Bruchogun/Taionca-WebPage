const {test,expect}=require('@playwright/test');
const {login,query,createOdt}=require('../helpers/app');
const {post,account,income,balance}=require('../helpers/audit');
test.beforeEach(async({request})=>{
 await login(request,'test-user-203');
 await query('DELETE FROM attendances WHERE id_user=203');
 await query('DELETE FROM payroll_not_assign_hours WHERE id_user=203');
});
for(const [duration,paid] of [[4,4],[7,7],[7.5,6.5],[9,8]])test('asistencia '+duration+' horas acredita '+paid,async({request})=>{
 const entry=new Date('2026-01-10T12:00:00Z'),departure=new Date(+entry+duration*3600000);
 await post(request,'attendance',{entry_date:entry.toISOString(),departure_date:departure.toISOString()});
 expect((await query('SELECT hours FROM payroll_not_assign_hours WHERE id_user=203'))[0].hours).toBe(paid);
 const {attendances}=await (await request.get('/api/public/get_attendance')).json();expect(attendances.every(a=>a.id_user===203)).toBe(true);
 expect(new Date(attendances[0].departure_date)-new Date(attendances[0].entry_date)).toBe(duration*3600000);
});
test('entrada y salida separadas acumulan horas una sola vez',async({request})=>{
 await post(request,'attendance',{entry_date:'2026-01-11T12:00:00Z'});
 const duplicate=await request.post('/api/public/attendance',{data:{entry_date:'2026-01-11T13:00:00Z'}});expect(duplicate.status()).toBe(409);
 await post(request,'attendance',{departure_date:'2026-01-11T21:00:00Z'});
 expect((await request.post('/api/public/attendance',{data:{departure_date:'2026-01-11T22:00:00Z'}})).status()).toBe(409);
 await post(request,'attendance',{entry_date:'2026-01-12T12:00:00Z',departure_date:'2026-01-12T16:00:00Z'});
 expect((await query('SELECT hours FROM payroll_not_assign_hours WHERE id_user=203'))[0].hours).toBe(12);
});
for(const data of [{},{entry_date:'invalid'},{entry_date:'2026-01-10T13:00:00Z',departure_date:'2026-01-10T12:00:00Z'}])test('asistencia rechaza datos inválidos '+JSON.stringify(data),async({request})=>{
 const response=await request.post('/api/public/attendance',{data});expect(response.status()).toBe(400);
 expect(await query('SELECT * FROM attendances WHERE id_user=203')).toEqual([]);
});
test('dos llegadas simultáneas dejan un único registro abierto',async({request})=>{
 const results=await Promise.all([1,2].map(()=>request.post('/api/public/attendance',{data:{entry_date:'2026-01-10T12:00:00Z'}})));
 expect(results.map(r=>r.status()).sort()).toEqual([200,409]);
 expect((await query('SELECT * FROM attendances WHERE id_user=203')).length).toBe(1);
});
test('asignación de horas usa disponibilidad guardada y rechaza exceso manipulado',async({request})=>{
 await post(request,'attendance',{entry_date:'2026-01-11T12:00:00Z',departure_date:'2026-01-11T21:00:00Z'});
 await login(request);const odt=await createOdt();
 await post(request,'new_payroll_hours',{id_user:203,id_odt:odt.id_odt,hours_available:999,hours_spent:3});
 expect((await query('SELECT hours FROM payroll_not_assign_hours WHERE id_user=203'))[0].hours).toBe(5);
 const r=await request.post('/api/public/new_payroll_hours',{data:{id_user:203,id_odt:odt.id_odt,hours_available:999,hours_spent:6}});expect(r.status()).toBe(400);
 expect((await query('SELECT sum(hours_spent)::float h FROM payroll_odt_hours WHERE id_odt=$1',[odt.id_odt]))[0].h).toBe(3);
 const list=await (await request.get('/api/public/payroll_not_assign_hours')).json();expect(Number(list.payroll_not_assign_hours.find(u=>u.id_user===203).hours)).toBe(5);
});
test('asignaciones simultáneas no gastan dos veces las horas disponibles',async({request})=>{
 await query('INSERT INTO payroll_not_assign_hours(id_user,hours) VALUES(203,5)');await login(request);const odt=await createOdt();
 const results=await Promise.all([1,2].map(()=>request.post('/api/public/new_payroll_hours',{data:{id_user:203,id_odt:odt.id_odt,hours_available:5,hours_spent:4}})));
 expect(results.map(r=>r.status()).sort()).toEqual([200,400]);expect((await query('SELECT hours FROM payroll_not_assign_hours WHERE id_user=203'))[0].hours).toBe(1);
});
async function payroll(request){
 await login(request);await query('INSERT INTO payroll_variables(base_salary,food_voucher,base_extra_salary,ivss_discount) VALUES(10,2,20,0.045)');
 // Use the same pay period regardless of test execution order.
 await query("UPDATE payroll_records SET created_at=now()-interval '7 days'");
 const a=await account(request);await income(request,a,1000);const one=await createOdt(),two=await createOdt();
 const hours=await query('INSERT INTO payroll_odt_hours(id_supervisor,id_user,id_odt,hours_spent) VALUES(1,203,$1,3),(1,203,$2,5) RETURNING *',[one.id_odt,two.id_odt]);
 return {a,hours,payrolls:hours.map(h=>({id_payroll_odt_hour:h.id_payroll_odt_hour,id_account:a.id_account,payroll_code:'usd',odt_code:'usd'}))};
}
test('previsualizar, pagar y conciliar nómina distribuida en dos ODTs sin doble pago',async({request})=>{
 const {a,hours,payrolls}=await payroll(request);
 const preview=await post(request,'payroll_preview',{payrolls});expect(Number(preview.payroll[0].v_amount)).toBe(91.68);
 await post(request,'new_payroll_expense',{payrolls});expect(await balance(a)).toBe(908.32);
 const expenses=await query('SELECT h.id_odt,e.id_odt AS expense_odt,e.amount,h.is_paid FROM payroll_records r JOIN payroll_odt_hours h USING(id_payroll_odt_hour) JOIN general_expenses e USING(id_general_expense) WHERE h.id_payroll_odt_hour=ANY($1) ORDER BY h.id_payroll_odt_hour',[hours.map(h=>h.id_payroll_odt_hour)]);
 expect(expenses.map(e=>Number(e.amount))).toEqual([34.38,57.3]);expect(expenses.every(e=>e.id_odt===e.expense_odt&&e.is_paid)).toBe(true);
 expect((await request.post('/api/public/new_payroll_expense',{data:{payrolls}})).status()).toBe(409);expect(await balance(a)).toBe(908.32);
 const pending=await (await request.get('/api/public/payroll_odt_hours')).json();expect(pending.payroll_odt_hours.some(h=>hours.some(x=>x.id_payroll_odt_hour===h.id_payroll_odt_hour))).toBe(false);
});
test('nómina rechaza filas repetidas y revierte todo si el saldo es insuficiente',async({request})=>{
 const {a,hours,payrolls}=await payroll(request);
 expect((await request.post('/api/public/new_payroll_expense',{data:{payrolls:[payrolls[0],payrolls[0]]}})).status()).toBe(400);
 await query('UPDATE balances SET balance=1 WHERE id_account=$1 AND id_entity=1',[a.id_account]);
 expect((await request.post('/api/public/new_payroll_expense',{data:{payrolls}})).status()).toBe(400);
 expect(await balance(a)).toBe(1);expect((await query('SELECT * FROM payroll_records WHERE id_payroll_odt_hour=ANY($1)',[hours.map(h=>h.id_payroll_odt_hour)]))).toEqual([]);
 expect((await query('SELECT bool_or(is_paid) AS paid FROM payroll_odt_hours WHERE id_payroll_odt_hour=ANY($1)',[hours.map(h=>h.id_payroll_odt_hour)]))[0].paid).toBe(false);
});
test('pagos simultáneos de nómina solo debitan una vez',async({request})=>{
 const {a,payrolls}=await payroll(request);const results=await Promise.all([1,2].map(()=>request.post('/api/public/new_payroll_expense',{data:{payrolls}})));
 expect(results.map(r=>r.status()).sort()).toEqual([200,409]);expect(await balance(a)).toBe(908.32);
});
