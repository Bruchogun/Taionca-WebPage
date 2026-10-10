import { query } from '../db';
import { units } from '../lib/money';
const moneyRoutes=['money_incomes','investments','give_loan','pay_loan','admin_expenses','general_expenses','transfer_entitys','exchange_currency','update_limit_resources','update_admin_percent','nueva_odt'];
export default async(req,res,next)=>{
    const route=req.path.replace('/public/','');
    if(req.method!=='POST'||!moneyRoutes.includes(route)) return next();
    try {
        const b=req.body;
        if(route==='update_admin_percent') {
            if(b.admin_percent===null || b.admin_percent===undefined || !Number.isFinite(Number(b.admin_percent)) || Number(b.admin_percent)<0 || Number(b.admin_percent)>1) throw Error('Porcentaje administrativo inválido.');
            return next();
        }
        if(route==='exchange_currency') {units(b.expense?.amount,true);units(b.income?.amount,true);}
        else units(b.amount,route!=='update_limit_resources');
        if(b.description && b.description.length>512) throw Error('La descripción supera los 512 caracteres.');
        if(route==='nueva_odt') {
            if(!Number.isFinite(Number(b.admin_percent))||Number(b.admin_percent)<0||Number(b.admin_percent)>1) throw Error('Porcentaje administrativo inválido.');
            return next();
        }
        let entries;
        if(route==='transfer_entitys') entries=[b.expense,b.income];
        else if(route==='exchange_currency') entries=[{...b.expense,id_entity:b.id_entity},{...b.income,id_entity:b.id_entity}];
        else entries=[{id_account:b.account?.id_account||b.id_account,id_entity:['give_loan','pay_loan','general_expenses'].includes(route)?1:route==='admin_expenses'?2:b.id_entity}];
        for(const e of entries) {
            const a=(await query('SELECT a.*,c.code FROM accounts a JOIN currencys c USING(id_currency) WHERE id_account=$1',[e?.id_account])).rows[0];
            if(!a) throw Error('Cuenta no encontrada.');
            e.id_currency=a.id_currency;
            if(route!=='update_limit_resources' && !(await query('SELECT id_balance FROM balances WHERE id_account=$1 AND id_entity=$2',[e.id_account,e.id_entity])).rows.length) throw Error('La entidad no tiene saldo asociado a esa cuenta.');
            if(b.account) {b.account.id_currency=a.id_currency;b.account.code=a.code;}
            if(['general_expenses','admin_expenses'].includes(route)) b.expense_currency_code=a.code;
        }
        if(['exchange_currency','transfer_entitys'].includes(route)) {
            b.expense.id_currency=entries[0].id_currency;b.income.id_currency=entries[1].id_currency;
            if(b.expense.id_account===b.income.id_account && (route==='exchange_currency'||b.expense.id_entity===b.income.id_entity)) throw Error('Seleccione cuentas o entidades diferentes.');
            if(route==='exchange_currency'?entries[0].id_currency===entries[1].id_currency:entries[0].id_currency!==entries[1].id_currency) throw Error('Las monedas de las cuentas no corresponden a esta operación.');
        }
        if(route==='general_expenses') {
            units(b.quantity,true);
            const odt=(await query('SELECT c.code FROM odts JOIN currencys c USING(id_currency) WHERE id_odt=$1',[b.id_odt])).rows[0];
            if(!odt) throw Error('ODT no encontrada.');b.odt_currency_code=odt.code;
        }
        return next();
    }catch(error){res.statusCode=400;return res.json({error:error.code?'Revisa los datos de la operación.':error.message});}
};
