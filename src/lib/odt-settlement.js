import { validId, validateClosure } from './odt-closure';
import { units, money, percentage, roundedRatio } from './money';
const ZERO = BigInt(0);

export function defaultPart(id_currency, admin_percent) {
    return { id_currency, admin_percent: String(admin_percent || '0'), ceo_percent: '0.1',
        admin_users: [], operative_users: [], supervisor_users: [] };
}
export function initialSettlement(source, mode = 'split', target = source.odt.id_currency) {
    const available = new Set(source.currencies.map(c => c.id_currency));
    const ids = mode === 'split' ? Array.from(available) : [Number(target)];
    return { id_odt: source.odt.id_odt, version: source.version, mode,
        id_currency: mode === 'split' ? null : Number(target), id_account: null, exchanges: [], income_values: [],
        expenses: source.expenses.map(e => ({ expense_key: e.expense_key,
            id_currency: mode === 'split' ? (available.has(e.source_currency) ? e.source_currency : null) : Number(target),
            amount: e.source_currency === (mode === 'split' ? e.source_currency : Number(target)) &&
                (mode !== 'split' || available.has(e.source_currency)) && e.source_amount !== null ? e.source_amount : '' })),
        parts: ids.map(id => defaultPart(id, source.odt.admin_percent)) };
}

// Shared exact preview. The server repeats this using a fresh, locked database snapshot.
export function calculateSettlement(source, input) {
    const errors = [];
    const fail = (message, extra = {}) => errors.push({ message, ...extra });
    const result = { errors, parts: [], revenues: [], expenses: [], exchanges: [], valid: false };
    if (!source || !input || typeof input !== 'object') { fail('Carga los datos del cierre.'); return result; }
    if (!validId(input.id_odt) || Number(input.id_odt) !== source.odt.id_odt) fail('La ODT seleccionada no coincide.');
    if (input.version !== source.version) fail('Los abonos o gastos cambiaron. Recarga el cierre y revisa los importes.');
    if (source.odt.closed) fail('La ODT ya está cerrada.');
    if (!source.currencies.length) fail('Esta ODT no tiene abonos.');
    if (source.odt.paid_amount !== source.odt.amount) fail('La ODT debe estar completamente pagada antes de cerrarla.');
    if (source.pending_payroll) fail('Hay horas de nómina pendientes de pago.');
    if (!['single','split'].includes(input.mode)) { fail('Selecciona la modalidad del cierre.'); return result; }
    const available = new Map(source.currencies.map(c => [c.id_currency, c]));
    const target = Number(input.id_currency);
    if (input.mode === 'single' && (!validId(input.id_currency) || (target !== source.odt.id_currency && !available.has(target)))) {
        fail('La moneda del cierre debe ser la original de la ODT o una moneda recibida en sus abonos.'); return result;
    }
    if (input.mode === 'split' && input.id_currency != null) fail('Cada mini cierre conserva su moneda.');
    const targetIds = input.mode === 'split' ? Array.from(available.keys()) : [target];
    const rows = new Map(targetIds.map(id => [id, {id_currency:id, income:ZERO, general:ZERO, inventory:ZERO}]));
    const code = id => (available.get(id) || (id === source.odt.id_currency ? {code:source.odt.currency_code} : {})).code || String(id);
    const decimal = (value, positive, label, extra) => {
        try { return units(value,positive); } catch (err) { fail(label + ': ' + err.message,extra); return null; }
    };
    function records(list, key, allowed, label) {
        const map = new Map();
        if (!Array.isArray(list)) { fail('Revisa ' + label + '.'); return map; }
        for (const item of list) {
            const id = key === 'expense_key' ? item && item[key] : Number(item && item[key]);
            if (!item || !allowed.has(id) || map.has(id)) { fail('Hay datos repetidos o desconocidos en ' + label + '.'); continue; }
            map.set(id,item);
        }
        return map;
    }
    const requiredValues = new Set(input.mode === 'single' && target !== source.odt.id_currency
        ? source.currencies.filter(c => c.id_currency !== target).map(c => c.id_currency) : []);
    const values = records(input.income_values,'id_currency',requiredValues,'los equivalentes de ingresos');
    for (const currency of source.currencies) {
        const destination = input.mode === 'split' ? currency.id_currency : target;
        let value; let valuation_source;
        if (destination === currency.id_currency) { value=units(currency.amount,true); valuation_source='native'; }
        else if (input.mode === 'single' && target === source.odt.id_currency) { value=units(currency.amount_odt,true); valuation_source='payment_equivalent'; }
        else { value=decimal(values.get(currency.id_currency) && values.get(currency.id_currency).amount,true,
            'Indica cuánto representan los ingresos en ' + currency.code + ' al cerrar en ' + code(target)); valuation_source='manual'; }
        if (value !== null) {
            rows.get(destination).income += value;
            result.revenues.push({source_currency:currency.id_currency,source_amount:currency.amount,
                id_currency:destination,amount:money(value),valuation_source});
        }
    }
    const expenses = records(input.expenses,'expense_key',new Set(source.expenses.map(e=>e.expense_key)),'los gastos');
    for (const expense of source.expenses) {
        const entry = expenses.get(expense.expense_key);
        const id = Number(entry && entry.id_currency);
        const extra = {expense_key:expense.expense_key};
        if (!entry || !validId(entry.id_currency) || !rows.has(id)) { fail('Selecciona la moneda de destino del gasto ' + expense.expense_key + '.',extra); continue; }
        const value = decimal(entry.amount,expense.source_amount === null || units(expense.source_amount)>ZERO,
            'Gasto ' + expense.expense_key,extra);
        if (value === null) continue;
        if (id === expense.source_currency && expense.source_amount !== null && value !== units(expense.source_amount)) {
            fail('El gasto ' + expense.expense_key + ' conserva su importe original cuando no cambia de moneda.',extra); continue;
        }
        rows.get(id)[expense.category === 'general' ? 'general' : 'inventory'] += value;
        result.expenses.push({...expense,id_currency:id,amount:money(value)});
    }
    const settings = records(input.parts,'id_currency',new Set(targetIds),'las comisiones de cada cierre');
    for (const id of targetIds) {
        const row = rows.get(id); const config=settings.get(id);
        if (!config) { fail('Revisa los porcentajes del cierre en ' + code(id) + '.'); continue; }
        const validation = validateClosure({...config,id_odt:source.odt.id_odt,settle_payments:true,id_account:null,amount:'1'});
        if (validation) { fail(code(id) + ': ' + validation,{id_currency:id}); continue; }
        // Check aggregates against database precision before attempting any write.
        for (const value of [row.income,row.general,row.inventory]) decimal(money(value),false,'Total en ' + code(id));
        const admin = percentage(row.income,config.admin_percent);
        const gross = row.income-row.general-row.inventory-admin;
        if (gross<ZERO) fail('El cierre en ' + code(id) + ' tiene utilidad negativa. Selecciona qué gastos reasignar e ingresa sus importes en otra moneda.',{id_currency:id,kind:'deficit'});
        const commissions = [];
        for (const [role,users] of [['ceo',[{id_user:2,profit_percent:config.ceo_percent}]],['admin',config.admin_users],['operative',config.operative_users],['supervisor',config.supervisor_users]]) {
            for (const user of users) commissions.push({role,id_user:Number(user.id_user),profit_percent:String(user.profit_percent),
                profit:money(gross<ZERO?ZERO:percentage(gross,user.profit_percent))});
        }
        const totalCommission=commissions.reduce((sum,c)=>sum+units(c.profit),ZERO);
        const company=row.income-admin-totalCommission;
        if (company<ZERO) fail('El redondeo de las comisiones supera los ingresos de ' + code(id) + '.');
        result.parts.push({id_currency:id,code:code(id),amount:money(row.income),admin_percent:String(config.admin_percent),
            admin_amount:money(admin),general_expense:money(row.general),inv_expense:money(row.inventory),
            gross_profit:money(gross),taionca_profit:money(company),commissions});
    }
    if (!Array.isArray(input.exchanges)) fail('Revisa los cambios de moneda.');
    if (input.mode === 'split') {
        if (input.id_account != null || (input.exchanges || []).length) fail('Los mini cierres usan sus cuentas originales, sin cambios de moneda bancarios.');
    } else {
        const destination=source.accounts.find(a=>a.id_account===Number(input.id_account) && a.id_currency===target);
        if (!validId(input.id_account) || !destination) fail('Selecciona una cuenta en la moneda del reparto.');
        const used = new Set();
        for (const exchange of Array.isArray(input.exchanges) ? input.exchanges : []) {
            const origin=source.accounts.find(a=>a.id_account===Number(exchange && exchange.id_account_from));
            if (!origin || origin.id_currency===target || !source.payment_accounts.some(a=>a.id_account===origin.id_account) || used.has(origin.id_account)) {
                fail('El cambio debe salir de una cuenta de abonos en otra moneda, sin repetir cuentas.'); continue;
            }
            used.add(origin.id_account);
            const from=decimal(exchange.amount_from,true,'Monto que sale de ' + origin.name);
            const to=decimal(exchange.amount_to,true,'Monto que llega a la cuenta de reparto');
            if (from!==null && to!==null && destination) result.exchanges.push({account_from:origin.id_account,account_to:destination.id_account,amount_from:money(from),amount_to:money(to)});
        }
    }
    result.valid=errors.length===0;
    return result;
}

// Exact row and column totals: every beneficiary receives the exact native amount;
// remaining capacities prevent a rounding unit from overdrawing a small account.
export function allocateRecipients(accounts, recipients) {
    const remaining=accounts.map(a=>({...a,remaining:units(a.amount)}));
    const entries=[];
    for (const recipient of recipients.filter(r=>r.id_entity!==1).sort((a,b)=>a.id_entity-b.id_entity)) {
        const total=remaining.reduce((sum,a)=>sum+a.remaining,ZERO);
        const due=units(recipient.amount);
        if (due>total) throw new Error('El reparto supera los ingresos disponibles.');
        let cumulative=ZERO,allocated=ZERO;
        for (const account of remaining) {
            cumulative+=account.remaining;
            const amount=total===ZERO?ZERO:roundedRatio(due*cumulative,total)-allocated;
            allocated+=amount;account.remaining-=amount;
            entries.push({id_account:account.id_account,id_entity:recipient.id_entity,amount:money(amount)});
        }
    }
    for (const account of remaining) entries.push({id_account:account.id_account,id_entity:1,amount:money(account.remaining)});
    return entries;
}
