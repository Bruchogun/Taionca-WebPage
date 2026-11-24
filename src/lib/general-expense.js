import { units, money } from './money';
import { validId } from './odt-closure';
import { invalid } from './api-transaction';
import { requireOpenOdt } from './odt-access';

export function validateGeneralExpense(input){
    if(!input||!validId(input.id_odt)||!validId(input.id_account)||!validId(input.id_measure))return 'Selecciona ODT, cuenta y unidad validas.';
    if(input.rate!==undefined||input.historical_source!==undefined)return 'La tasa historica pendiente solo se registra mediante el importador auditado.';
    try{units(input.amount,true);units(input.quantity,true);}catch(error){return 'Monto total y cantidad deben ser positivos y tener hasta 10 decimales.';}
    if(typeof input.description!=='string'||input.description.length>512)return 'La descripcion admite hasta 512 caracteres.';
    return '';
}
async function expenseCurrencies(db, input, userId, lock) {
    const odt = await requireOpenOdt(db, input.id_odt, userId, lock);
    const { rows: [account] } = await db.query(
        'SELECT id_currency FROM accounts WHERE id_account=$1' + (lock ? ' FOR SHARE' : ''), [input.id_account]
    );
    if (!account) invalid('La cuenta no existe.', 404);
    const { rows } = await db.query(
        'SELECT id_currency, upper(code) AS code FROM currencys WHERE id_currency=ANY($1) ORDER BY id_currency' +
        (lock ? ' FOR SHARE' : ''), [[odt.id_currency, account.id_currency]]
    );
    const codes = new Map(rows.map(currency => [currency.id_currency, currency.code]));
    const odtCode = codes.get(odt.id_currency);
    const accountCode = codes.get(account.id_currency);
    if (!odtCode || !accountCode) invalid('La ODT y la cuenta deben tener monedas válidas.');
    return { odtCurrency: odt.id_currency, accountCurrency: account.id_currency, odtCode, accountCode };
}

export async function prepareGeneralExpense(db, input, userId, fetchRate) {
    const error = validateGeneralExpense(input);
    if (error) invalid(error);
    const currencies = await expenseCurrencies(db, input, userId, false);
    let rate;
    try {
        rate = await fetchRate(currencies.odtCode, currencies.accountCode);
    } catch (error) {
        invalid(error.message, 503);
    }
    if (!Number.isFinite(Number(rate)) || Number(rate) <= 0 || Number(rate) >= 1e20) {
        invalid('No hay una tasa válida para las monedas seleccionadas.', 503);
    }
    return { ...currencies, rate };
}

export async function recordGeneralExpense(client,input,userId,valuation){
    const error = validateGeneralExpense(input);
    if (error) invalid(error);
    const prepared = typeof valuation === 'function'
        ? await prepareGeneralExpense(client, input, userId, valuation)
        : valuation;
    const currencies = await expenseCurrencies(client, input, userId, true);
    if (Object.keys(currencies).some(key => currencies[key] !== prepared[key])) {
        invalid('Las monedas del gasto cambiaron. Vuelve a intentarlo.', 409);
    }
    const amount=money(units(input.amount,true)),quantity=money(units(input.quantity,true));
    const balance=(await client.query('SELECT id_balance,balance FROM balances WHERE id_account=$1 AND id_entity=1 FOR UPDATE',[input.id_account])).rows[0];
    if(!balance||units(balance.balance)<units(amount))invalid('Saldo de Taionca insuficiente para el gasto.');
    await client.query('UPDATE limit_resources SET amount=amount-$1::numeric WHERE id_account=$2 AND id_odt=$3',[amount,input.id_account,input.id_odt]);
    const expense=(await client.query(`INSERT INTO general_expenses(id_account,id_odt,amount,description,rate,id_measure,quantity,id_user)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_general_expense`,
        [input.id_account,input.id_odt,amount,input.description,String(prepared.rate),input.id_measure,quantity,userId])).rows[0];
    const movement=(await client.query("SELECT * FROM alter_balance($1,-$2::numeric,$3,'general_expenses')",[balance.id_balance,amount,expense.id_general_expense])).rows[0];
    return{...movement,id_general_expense:expense.id_general_expense};
}
