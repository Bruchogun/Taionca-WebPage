import { pool, query } from '../../../db';
import { safeOdtExpense } from '../../../lib/odt-expense-errors';
import { getRate } from '../../../lib/exchange-rate';
import { prepareGeneralExpense, recordGeneralExpense } from '../../../lib/general-expense';

export const post = safeOdtExpense(
    async (req, res) => {
        const user=req.session&&req.session.user;
        if(!user){res.statusCode=401;return res.json({error:'Debes iniciar sesion para registrar gastos.'});}
        if(!req.authorized){res.statusCode=403;return res.json({error:'No tienes permiso para registrar gastos.'});}
        const valuation = await prepareGeneralExpense({ query }, req.body, user.user_id, getRate);
        const client=await pool.connect();
        try{
            await client.query('BEGIN');
            const data=await recordGeneralExpense(client,req.body,user.user_id,valuation);
            await client.query('COMMIT');
            return res.json({success:'Gasto realizado',data});
        }catch(error){await client.query('ROLLBACK').catch(() => {});throw error;}
        finally{client.release();}
    });
