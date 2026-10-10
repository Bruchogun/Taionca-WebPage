import { invalid } from './api-transaction';
import { getRate } from '../functions';
import { units, money } from './money';
export async function payrollRows(client,payrolls,lock=false) {
    if (!Array.isArray(payrolls) || !payrolls.length || payrolls.some(p=>!Number.isInteger(p.id_payroll_odt_hour)||!Number.isInteger(p.id_account))) invalid('Seleccione horas y cuentas válidas.');
    const ids=payrolls.map(p=>p.id_payroll_odt_hour);
    if(new Set(ids).size!==ids.length) invalid('Una asignación de horas no puede pagarse dos veces.');
    if(lock) await client.query('SELECT id_odt FROM odts WHERE id_odt IN (SELECT id_odt FROM payroll_odt_hours WHERE id_payroll_odt_hour=ANY($1)) ORDER BY id_odt FOR UPDATE',[ids]);
    const {rows}=await client.query(`SELECT h.*,c.code AS odt_code FROM payroll_odt_hours h JOIN odts o USING(id_odt) JOIN currencys c USING(id_currency)
        WHERE id_payroll_odt_hour=ANY($1) ORDER BY id_payroll_odt_hour ${lock?'FOR UPDATE OF h':''}`,[ids]);
    if(rows.length!==ids.length) invalid('No se encontraron todas las horas.');
    if(rows.some(h=>h.is_paid)) invalid('Estas horas ya fueron pagadas.',409);
    for(const row of rows) {
        const selection=payrolls.find(p=>p.id_payroll_odt_hour===row.id_payroll_odt_hour);
        const account=(await client.query('SELECT a.*,c.code FROM accounts a JOIN currencys c USING(id_currency) WHERE id_account=$1',[selection.id_account])).rows[0];
        if(!account) invalid('Cuenta no encontrada.');
        row.id_account=account.id_account;row.payroll_code=account.code;
    }
    return rows;
}
export async function payrollPreview(client,rows) {
    return (await client.query('SELECT v_id_user,v_id_account,v_total_hours::numeric(30,10),v_amount::numeric(30,10) FROM payroll_preview($1::json)',[JSON.stringify(rows)])).rows;
}
export async function payPayroll(client,rows) {
    const groups=await payrollPreview(client,rows);
    // Lock all affected balances in a deterministic order before debiting.
    await client.query('SELECT id_balance FROM balances WHERE id_entity=1 AND id_account=ANY($1) ORDER BY id_balance FOR UPDATE',[rows.map(r=>r.id_account)]);
    for(const group of groups) {
        const part=rows.filter(h=>h.id_user===group.v_id_user&&h.id_account===group.v_id_account);
        const total=units(group.v_amount),hours=units(group.v_total_hours);
        let assigned=BigInt(0);
        for(let i=0;i<part.length;i++) {
            const row=part[i],amount=i===part.length-1?total-assigned:total*units(row.hours_spent)/hours;
            assigned+=amount;
            const rate=await getRate(row.odt_code,row.payroll_code);
            const expense=(await client.query(`INSERT INTO general_expenses(id_account,id_odt,amount,description,rate,id_measure,quantity)
                VALUES($1,$2,$3,'Pago de nómina',$4,9,$5) RETURNING id_general_expense`,[row.id_account,row.id_odt,money(amount),rate,row.hours_spent])).rows[0];
            const balance=(await client.query('SELECT id_balance FROM balances WHERE id_account=$1 AND id_entity=1',[row.id_account])).rows[0];
            if(!balance) invalid('La cuenta no tiene saldo de Taionca.');
            await client.query("SELECT alter_balance($1,-$2::numeric,$3,'general_expenses')",[balance.id_balance,money(amount),expense.id_general_expense]);
            await client.query('INSERT INTO payroll_records(id_payroll_odt_hour,id_general_expense) VALUES($1,$2)',[row.id_payroll_odt_hour,expense.id_general_expense]);
            await client.query('UPDATE payroll_odt_hours SET is_paid=true WHERE id_payroll_odt_hour=$1',[row.id_payroll_odt_hour]);
        }
    }
    return groups;
}
