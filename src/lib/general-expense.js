import { units, money } from './money';
import { validId } from './odt-closure';
const fail=message=>{const error=new Error(message);error.code='P0001';throw error;};
export function validateGeneralExpense(input){
    if(!input||!validId(input.id_odt)||!validId(input.id_account)||!validId(input.id_measure))return 'Selecciona ODT, cuenta y unidad validas.';
    if(input.rate!==undefined||input.historical_source!==undefined)return 'La tasa historica pendiente solo se registra mediante el importador auditado.';
    try{units(input.amount,true);units(input.quantity,true);}catch(error){return 'Monto total y cantidad deben ser positivos y tener hasta 10 decimales.';}
    if(typeof input.description!=='string'||input.description.length>512)return 'La descripcion admite hasta 512 caracteres.';
    return '';
}
export async function recordGeneralExpense(client,input,userId,fetchRate){
    const error=validateGeneralExpense(input);if(error)fail(error);
    const odt=(await client.query(`SELECT o.id_odt,o.id_user,upper(c.code) AS code FROM odts o JOIN currencys c USING(id_currency)
        WHERE o.id_odt=$1 FOR UPDATE OF o`,[input.id_odt])).rows[0];
    if(!odt)fail('La ODT no existe.');
    if(![1,11,odt.id_user].includes(userId)&&odt.id_user!==1)fail('No tienes acceso a esta ODT.');
    if((await client.query('SELECT 1 FROM closure_odts WHERE id_odt=$1',[input.id_odt])).rowCount)fail('No se pueden cambiar los gastos de una ODT cerrada.');
    const account=(await client.query(`SELECT a.id_account,upper(c.code) AS code FROM accounts a JOIN currencys c USING(id_currency)
        WHERE a.id_account=$1 FOR SHARE OF a`,[input.id_account])).rows[0];
    if(!account)fail('La cuenta no existe.');
    const rate=await fetchRate(odt.code,account.code);
    if(rate===null||rate===undefined||!Number.isFinite(Number(rate))||Number(rate)<=0||Number(rate)>=1e20)fail('No hay una tasa valida para las monedas reales.');
    const amount=money(units(input.amount,true)),quantity=money(units(input.quantity,true));
    const balance=(await client.query('SELECT id_balance,balance FROM balances WHERE id_account=$1 AND id_entity=1 FOR UPDATE',[input.id_account])).rows[0];
    if(!balance||units(balance.balance)<units(amount))fail('Saldo de Taionca insuficiente para el gasto.');
    await client.query('UPDATE limit_resources SET amount=amount-$1::numeric WHERE id_account=$2 AND id_odt=$3',[amount,input.id_account,input.id_odt]);
    const expense=(await client.query(`INSERT INTO general_expenses(id_account,id_odt,amount,description,rate,id_measure,quantity,id_user)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_general_expense`,
        [input.id_account,input.id_odt,amount,input.description,String(rate),input.id_measure,quantity,userId])).rows[0];
    const movement=(await client.query("SELECT * FROM alter_balance($1,-$2::numeric,$3,'general_expenses')",[balance.id_balance,amount,expense.id_general_expense])).rows[0];
    return{...movement,id_general_expense:expense.id_general_expense};
}
