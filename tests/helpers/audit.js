const { expect } = require('@playwright/test');
const { query } = require('./app');
let serial = 0;
const unique = (label='Auditoría') => `${label} ${Date.now()} ${++serial}`;
async function post(request, endpoint, data) {
    const response = await request.post('/api/public/'+endpoint, {data});
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(200);
    expect(body.error, JSON.stringify(body)).toBeUndefined();
    return body;
}
async function account(request, currency=1) {
    const name=unique('Cuenta'); await post(request,'create_account',{name,id_currency:currency});
    return (await query('SELECT * FROM accounts WHERE name=$1',[name]))[0];
}
async function income(request, a, amount, entity=1) {
    await post(request,'money_incomes',{id_account:a.id_account,id_entity:entity,amount,description:unique()});
}
async function balance(a, entity=1) {
    return Number((await query('SELECT balance FROM balances WHERE id_account=$1 AND id_entity=$2',[a.id_account,entity]))[0].balance);
}
async function item(request, type='spendable') {
    const supplier=(await post(request,'new_supplier',{name:unique('Proveedor')})).data.id_supplier;
    const storage=(await post(request,'new_storage',{name:unique('Almacén'),description:'Prueba',location:'Taller'})).data.id_storage;
    const data={code:unique('SKU'),description:unique('Artículo'),brand:unique('Marca'),cost:2,price:3,storage,measure:1,min_stock:2,mid_stock:5,max_stock:10,supplier,manufacture:'Local'};
    const body=await post(request,`new_${type}_item_product_brand`,data);
    const stock=(await query(`SELECT * FROM ${type}_stocks JOIN ${type}_items USING(id_${type}_item) WHERE id_${type}_stock=$1`,[body.data[`id_${type}_stock`]]))[0];
    return {...data,...stock,type};
}
module.exports={unique,post,account,income,balance,item};
