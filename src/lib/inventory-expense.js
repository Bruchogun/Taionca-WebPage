import { transaction,invalid } from './api-transaction';
import { getRate } from '../functions';
import { units,money } from './money';
export function inventoryExpense(type) {
    // Type is supplied only by the two route modules, never by a request.
    return transaction(async(req,client)=>{
        const {id_spendable_stock:id_stock,id_odt,description}=req.body;
        let quantity;try {quantity=units(req.body.amount,true);}catch(error){invalid(error.message);}
        const odt=(await client.query('SELECT o.*,c.code FROM odts o JOIN currencys c USING(id_currency) WHERE id_odt=$1 FOR UPDATE OF o',[id_odt])).rows[0];
        if(!odt) invalid('ODT no encontrada.');
        const stock=(await client.query(`SELECT s.*,i.price FROM ${type}_stocks s JOIN ${type}_items i USING(id_${type}_item) WHERE id_${type}_stock=$1 FOR UPDATE OF s`,[id_stock])).rows[0];
        if(!stock||units(stock.amount)<quantity) invalid('Inventario insuficiente.');
        const total=(await client.query('SELECT ($1::numeric*$2::numeric)::numeric(30,10) amount',[req.body.amount,stock.price])).rows[0].amount;
        const selected=(await client.query(`SELECT b.* FROM balances b JOIN accounts a USING(id_account)
            WHERE b.id_entity=1 AND a.id_currency=1 AND b.balance >= $1::numeric ORDER BY b.id_balance LIMIT 1 FOR UPDATE OF b`,[total])).rows[0];
        if(!selected) invalid('Saldo de Taionca insuficiente para el gasto de inventario.');
        await client.query('INSERT INTO balances(id_account,id_entity,balance) VALUES($1,3,0) ON CONFLICT(id_account,id_entity) DO NOTHING',[selected.id_account]);
        const destination=(await client.query('SELECT id_balance FROM balances WHERE id_account=$1 AND id_entity=3 FOR UPDATE',[selected.id_account])).rows[0];
        const rate=await getRate(odt.code,'USD');
        const expense=(await client.query(`INSERT INTO ${type}_inv_odt_expenses(id_${type}_stock,id_odt,amount,description,rate)
            VALUES($1,$2,$3,$4,$5) RETURNING id_${type}_inv_odt_expense AS id`,[id_stock,id_odt,money(quantity),description,rate])).rows[0];
        await client.query(`UPDATE ${type}_stocks SET amount=amount-$2 WHERE id_${type}_stock=$1`,[id_stock,money(quantity)]);
        await client.query('SELECT alter_balance($1,-$2::numeric,$3,$4::movement_category)',[selected.id_balance,total,expense.id,type+'_inv_odt_expenses']);
        await client.query('SELECT alter_balance($1,$2::numeric,$3,$4::movement_category)',[destination.id_balance,total,expense.id,type+'_inv_odt_expenses']);
        return {success:'Gasto realizado',result:[{id:expense.id}]};
    });
}
