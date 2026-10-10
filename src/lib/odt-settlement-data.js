import { createHash } from 'crypto';
import { paymentSummary } from './odt-payment-data';
import { calculateSettlement, allocateRecipients } from './odt-settlement';
import { units, money } from './money';
const ZERO=BigInt(0);
export function settlementError(message,code='P0001') { const error=new Error(message); error.code=code; return error; }

export async function settlementSource(client,id,userId,lock=false) {
    const odt=await paymentSummary(client,id,userId);
    const [row]=(await client.query('SELECT admin_percent FROM odts WHERE id_odt=$1',[id])).rows;
    odt.admin_percent=row.admin_percent;
    const currencies=(await client.query(`SELECT p.id_currency,upper(c.code) AS code,c.symbol,
        sum(p.amount)::numeric(30,10) AS amount,sum(p.amount_odt)::numeric(30,10) AS amount_odt
        FROM odt_payments p JOIN currencys c ON c.id_currency=p.id_currency WHERE p.id_odt=$1
        GROUP BY p.id_currency,c.code,c.symbol ORDER BY p.id_currency`,[id])).rows;
    const payment_accounts=(await client.query(`SELECT id_account,id_currency,sum(amount)::numeric(30,10) AS amount
        FROM odt_payments WHERE id_odt=$1 GROUP BY id_account,id_currency ORDER BY id_account`,[id])).rows;
    const expenses=(await client.query(`SELECT e.*,upper(c.code) AS source_code FROM odt_expense_sources($1) e
        LEFT JOIN currencys c ON c.id_currency=e.source_currency ORDER BY e.expense_key`,[id])).rows;
    const accounts=(await client.query(`SELECT a.id_account,a.id_currency,a.name,upper(c.code) AS code,
        coalesce(b.balance,0)::numeric(30,10) AS balance FROM accounts a JOIN currencys c USING(id_currency)
        LEFT JOIN balances b ON b.id_account=a.id_account AND b.id_entity=1 ORDER BY a.id_account`+
        (lock?' FOR SHARE OF a':''))).rows;
    const payroll=(await client.query(`SELECT id_user,id_supervisor,hours_spent,is_paid FROM payroll_odt_hours
        WHERE id_odt=$1 AND hours_spent>0 ORDER BY id_user,id_supervisor,hours_spent,is_paid`,[id])).rows;
    const pending_payroll=payroll.some(p=>p.is_paid!==true);
    const version=createHash('sha256').update(JSON.stringify({amount:odt.amount,currency:odt.id_currency,admin:odt.admin_percent,
        payments:odt.payments,currencies,expenses,payroll})).digest('hex');
    return {odt,currencies,payment_accounts,expenses,accounts,pending_payroll,version};
}

export async function settleOdt(client,input,userId) {
    const id=Number(input.id_odt);
    const {rows}=await client.query('SELECT id_odt,id_user FROM odts WHERE id_odt=$1 FOR UPDATE',[id]);
    if (!rows[0]) throw settlementError('La ODT no existe.','P0002');
    if (![1,11,rows[0].id_user].includes(userId) && rows[0].id_user!==1) throw settlementError('No tienes acceso a esta ODT.','42501');
    if ((await client.query('SELECT 1 FROM closure_odts WHERE id_odt=$1',[id])).rowCount) throw settlementError('La ODT ya está cerrada. No se duplicó el reparto.','23505');
    const source=await settlementSource(client,id,userId,true);
    const plan=calculateSettlement(source,input);
    if (!plan.valid) throw settlementError(plan.errors.map(e=>e.message).join(' '));
    const userIds=Array.from(new Set(plan.parts.flatMap(p=>p.commissions.map(c=>c.id_user)))).sort((a,b)=>a-b);
    const users=(await client.query('SELECT user_id,id_entity FROM users WHERE user_id=ANY($1) ORDER BY user_id FOR SHARE',[userIds])).rows;
    if (users.length!==userIds.length || users.some(u=>!u.id_entity)) throw settlementError('Un usuario de comisión no existe o no tiene entidad contable.');
    const entityFor=new Map(users.map(u=>[u.user_id,u.id_entity]));
    const allocations=[];
    for (const part of plan.parts) {
        const shares=new Map([[2,units(part.admin_amount)]]);
        for (const commission of part.commissions) {
            commission.id_entity=entityFor.get(commission.id_user);
            shares.set(commission.id_entity,(shares.get(commission.id_entity)||ZERO)+units(commission.profit));
        }
        const recipients=Array.from(shares,([id_entity,amount])=>({id_entity,amount:money(amount)}));
        const accounts=input.mode==='split' ? source.payment_accounts.filter(a=>a.id_currency===part.id_currency) :
            [{id_account:Number(input.id_account),amount:part.amount}];
        allocations.push(...allocateRecipients(accounts,recipients).filter(a=>a.id_entity!==1));
    }
    const keys=new Map();
    for (const entry of allocations) {
        keys.set(entry.id_account+':1',{id_account:entry.id_account,id_entity:1});
        keys.set(entry.id_account+':'+entry.id_entity,{id_account:entry.id_account,id_entity:entry.id_entity});
    }
    for (const change of plan.exchanges) for (const id_account of [change.account_from,change.account_to]) keys.set(id_account+':1',{id_account,id_entity:1});
    for (const key of Array.from(keys.values()).sort((a,b)=>a.id_account-b.id_account || a.id_entity-b.id_entity)) {
        await client.query('INSERT INTO balances(id_account,id_entity) VALUES($1,$2) ON CONFLICT(id_account,id_entity) DO NOTHING',[key.id_account,key.id_entity]);
        await client.query('SELECT id_balance FROM balances WHERE id_account=$1 AND id_entity=$2 FOR UPDATE',[key.id_account,key.id_entity]);
    }
    const {rows:[closure]}=await client.query(`INSERT INTO closure_odts(id_user,id_odt,id_account,amount,admin_expense_percent,
        general_expense,inv_expense,gross_profit,taionca_profit,settled_from_payments,settlement_mode)
        VALUES($1,$2,$3,$4,NULL,NULL,NULL,NULL,NULL,true,$5) RETURNING id_closure_odt`,
        [userId,id,input.mode==='single'?input.id_account:null,source.odt.paid_amount,input.mode]);
    const closureId=closure.id_closure_odt;
    for (const part of plan.parts) {
        const {rows:[stored]}=await client.query(`INSERT INTO closure_odt_parts(id_closure_odt,id_currency,amount,admin_percent,
            admin_amount,general_expense,inv_expense,gross_profit,taionca_profit)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_part`,[closureId,part.id_currency,part.amount,part.admin_percent,
            part.admin_amount,part.general_expense,part.inv_expense,part.gross_profit,part.taionca_profit]);
        for (const c of part.commissions) await client.query(`INSERT INTO closure_odt_part_commissions(id_part,id_user,id_entity,role,profit_percent,profit)
            VALUES($1,$2,$3,$4,$5,$6)`,[stored.id_part,c.id_user,c.id_entity,c.role,c.profit_percent,c.profit]);
    }
    for (const e of plan.expenses) await client.query(`INSERT INTO closure_odt_expenses(id_closure_odt,expense_key,category,source_currency,
        source_amount,id_currency,amount,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [closureId,e.expense_key,e.category,e.source_currency,e.source_amount,e.id_currency,e.amount,e.description||e.expense_key]);
    for (const r of plan.revenues) await client.query(`INSERT INTO closure_odt_revenues(id_closure_odt,source_currency,source_amount,id_currency,amount,valuation_source)
        VALUES($1,$2,$3,$4,$5,$6)`,[closureId,r.source_currency,r.source_amount,r.id_currency,r.amount,r.valuation_source]);
    for (const change of plan.exchanges) {
        const {rows:[balance]}=await client.query('SELECT balance FROM balances WHERE id_account=$1 AND id_entity=1',[change.account_from]);
        if (units(balance.balance)<units(change.amount_from)) throw settlementError('Saldo de Taionca insuficiente para el cambio desde la cuenta '+change.account_from+'.');
        const {rows:[exchange]}=await client.query("INSERT INTO exchange_currencys(description) VALUES($1) RETURNING id_exchange_currency",['Cambio manual para cierre ODT '+id]);
        await client.query(`SELECT alter_balance(id_balance,CASE WHEN id_account=$1 THEN -$3::numeric ELSE $4::numeric END,$5,'exchange_currency')
            FROM balances WHERE id_entity=1 AND id_account IN ($1,$2) ORDER BY id_account`,
            [change.account_from,change.account_to,change.amount_from,change.amount_to,exchange.id_exchange_currency]);
        await client.query(`INSERT INTO closure_odt_exchanges(id_closure_odt,id_exchange_currency,account_from,account_to,amount_from,amount_to)
            VALUES($1,$2,$3,$4,$5,$6)`,[closureId,exchange.id_exchange_currency,change.account_from,change.account_to,change.amount_from,change.amount_to]);
        const movements=(await client.query(`SELECT b.id_account,m.amount FROM balance_movements m JOIN balances b USING(id_balance)
            WHERE m.type_movement_category='exchange_currency' AND m.id_movement_category=$1 ORDER BY b.id_account`,[exchange.id_exchange_currency])).rows;
        if (movements.length!==2 || !movements.some(m=>m.id_account===change.account_from && m.amount==='-'+change.amount_from) ||
            !movements.some(m=>m.id_account===change.account_to && m.amount===change.amount_to)) throw settlementError('El cambio de moneda no coincide con los importes indicados.');
    }
    const outgoing=new Map();
    for (const a of allocations) outgoing.set(a.id_account,(outgoing.get(a.id_account)||ZERO)+units(a.amount));
    for (const [account,total] of Array.from(outgoing).sort((a,b)=>a[0]-b[0])) {
        const {rows:[balance]}=await client.query('SELECT id_balance,balance FROM balances WHERE id_account=$1 AND id_entity=1',[account]);
        if (units(balance.balance)<total) throw settlementError('Saldo de Taionca insuficiente para repartir en la cuenta '+account+'. Registra un cambio manual o repón el saldo.');
        if (total>ZERO) await client.query("SELECT alter_balance($1,-$2::numeric,$3,'closure_odts')",[balance.id_balance,money(total),closureId]);
        for (const a of allocations.filter(a=>a.id_account===account)) {
            await client.query('INSERT INTO closure_odt_allocations(id_closure_odt,id_account,id_entity,amount) VALUES($1,$2,$3,$4)',[closureId,a.id_account,a.id_entity,a.amount]);
            if (units(a.amount)>ZERO) await client.query("SELECT alter_balance(id_balance,$3,$4,'closure_odts') FROM balances WHERE id_account=$1 AND id_entity=$2",[a.id_account,a.id_entity,a.amount,closureId]);
        }
    }
    const mismatch=await client.query(`SELECT b.id_account FROM balance_movements m JOIN balances b USING(id_balance)
        WHERE m.type_movement_category='closure_odts' AND m.id_movement_category=$1 GROUP BY b.id_account HAVING sum(m.amount)<>0`,[closureId]);
    if (mismatch.rowCount) throw settlementError('El reparto no conserva los saldos de las cuentas. Se canceló el cierre.');
    const recorded=(await client.query(`SELECT b.id_account,b.id_entity,sum(m.amount)::numeric(30,10) AS amount
        FROM balance_movements m JOIN balances b USING(id_balance) WHERE m.type_movement_category='closure_odts'
        AND m.id_movement_category=$1 AND b.id_entity<>1 GROUP BY b.id_account,b.id_entity`,[closureId])).rows;
    for (const a of allocations) {
        const actual=recorded.find(r=>r.id_account===a.id_account && r.id_entity===a.id_entity);
        if ((actual?actual.amount:'0.0000000000')!==a.amount) throw settlementError('Una comisión registrada no coincide con su cálculo.');
    }
    if (recorded.some(r=>!allocations.some(a=>a.id_account===r.id_account && a.id_entity===r.id_entity))) throw settlementError('El reparto contiene un destinatario inesperado.');
    return {id_closure_odt:closureId,id_odt:id,amount:source.odt.paid_amount,symbol:source.odt.symbol,
        currency_code:source.odt.currency_code,settled_from_payments:true,settlement_mode:input.mode,
        account_name:input.mode==='single'?source.accounts.find(a=>a.id_account===Number(input.id_account)).name:
            source.payment_accounts.map(a=>source.accounts.find(b=>b.id_account===a.id_account).name).join(', '),parts:plan.parts};
}

export async function settlementDetails(client,id) {
    const {rows}=await client.query(`SELECT c.settlement_mode,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id_part',p.id_part,'id_currency',p.id_currency,'code',upper(m.code),
            'amount',p.amount::text,'admin_percent',p.admin_percent::text,'admin_amount',p.admin_amount::text,
            'general_expense',p.general_expense::text,'inv_expense',p.inv_expense::text,'gross_profit',p.gross_profit::text,
            'taionca_profit',p.taionca_profit::text,'commissions',coalesce((SELECT jsonb_agg(jsonb_build_object(
                'user_name',u.name||' '||u.lastname,'role',cc.role,'profit_percent',cc.profit_percent::text,'profit',cc.profit::text)
                ORDER BY cc.role,cc.id_user) FROM closure_odt_part_commissions cc JOIN users u ON u.user_id=cc.id_user WHERE cc.id_part=p.id_part),'[]'::jsonb))
            ORDER BY p.id_currency) FROM closure_odt_parts p JOIN currencys m USING(id_currency) WHERE p.id_closure_odt=c.id_closure_odt),'[]'::jsonb) AS parts,
        coalesce((SELECT jsonb_agg(jsonb_build_object('expense_key',e.expense_key,'description',e.description,
            'source_code',upper(s.code),'source_amount',e.source_amount::text,'code',upper(d.code),'amount',e.amount::text)
            ORDER BY e.expense_key) FROM closure_odt_expenses e LEFT JOIN currencys s ON s.id_currency=e.source_currency
            JOIN currencys d ON d.id_currency=e.id_currency WHERE e.id_closure_odt=c.id_closure_odt),'[]'::jsonb) AS expenses,
        coalesce((SELECT jsonb_agg(jsonb_build_object('source_code',upper(s.code),'source_amount',r.source_amount::text,
            'code',upper(d.code),'amount',r.amount::text,'valuation_source',r.valuation_source) ORDER BY r.source_currency)
            FROM closure_odt_revenues r JOIN currencys s ON s.id_currency=r.source_currency JOIN currencys d ON d.id_currency=r.id_currency
            WHERE r.id_closure_odt=c.id_closure_odt),'[]'::jsonb) AS revenues,
        coalesce((SELECT jsonb_agg(jsonb_build_object('account_from',a.name,'source_code',upper(s.code),'amount_from',e.amount_from::text,
            'account_to',b.name,'code',upper(d.code),'amount_to',e.amount_to::text) ORDER BY e.id_exchange_currency)
            FROM closure_odt_exchanges e JOIN accounts a ON a.id_account=e.account_from JOIN accounts b ON b.id_account=e.account_to
            JOIN currencys s ON s.id_currency=a.id_currency JOIN currencys d ON d.id_currency=b.id_currency
            WHERE e.id_closure_odt=c.id_closure_odt),'[]'::jsonb) AS exchanges
        FROM closure_odts c WHERE c.id_odt=$1`,[id]);
    return rows[0] || null;
}
