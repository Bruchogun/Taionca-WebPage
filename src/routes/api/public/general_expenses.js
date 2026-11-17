import { pool } from '../../../db';
import { safeOdtExpense } from '../../../lib/odt-expense-errors';
import { getRate } from "../../../functions";
import { recordGeneralExpense, validateGeneralExpense } from '../../../lib/general-expense';

export const post = safeOdtExpense(
    async (req, res) => {
        const user=req.session&&req.session.user;
        if(!user){res.statusCode=401;return res.json({error:'Debes iniciar sesion para registrar gastos.'});}
        if(!req.authorized){res.statusCode=403;return res.json({error:'No tienes permiso para registrar gastos.'});}
        const error=validateGeneralExpense(req.body);
        if(error){res.statusCode=400;return res.json({error});}
        const client=await pool.connect();
        try{
            await client.query('BEGIN');
            const data=await recordGeneralExpense(client,req.body,user.user_id,getRate);
            await client.query('COMMIT');
            return res.json({success:'Gasto realizado',data});
        }catch(error){await client.query('ROLLBACK');throw error;}
        finally{client.release();}
    });
