import { pool } from '../db';
export function invalid(message, status=400) {
    const error = new Error(message); error.status = status; throw error;
}
export function transaction(handler) {
    return async (req,res) => {
        let client;
        try {
            client = await pool.connect();
            await client.query('BEGIN');
            const result = await handler(req,client);
            await client.query('COMMIT');
            res.json(result);
        } catch(error) {
            if(client) await client.query('ROLLBACK').catch(()=>{});
            res.statusCode = error.status || (['23503','23514','23502','22P02','22003','22007'].includes(error.code) ? 400 : error.code==='23505' ? 409 : error.code==='P0001' ? (/cerrada/.test(error.message)?409:400) : 500);
            res.json({error:error.status || error.code==='P0001' ? error.message : res.statusCode===500 ? 'No se pudo completar la operación.' : 'Revisa los datos, el saldo y los registros existentes.'});
        } finally { if(client) client.release(); }
    };
}
