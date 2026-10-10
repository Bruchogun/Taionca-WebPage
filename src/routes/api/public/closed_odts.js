import { query } from "../../../db";

// List active odts
export const get =
    async (req, res) => {
        const { user_id } = req.session.user;

        const {rows: odts} = await query(
            `select currencys.*, clients.*, users.name as user_name, odts.* , odts.created_at as created_at, closure_odts.created_at as closed_at, odts.amount as amount, closure_odts.amount as paid_amount
            from odts
            join users on users.user_id = odts.id_user
            join currencys using(id_currency)
            join clients using(id_client)
            LEFT join closure_odts using(id_odt)
            where id_closure_odt is NOT NULL AND (odts.id_user = ${user_id} OR odts.id_user = 1 OR ${user_id} = 1 OR ${user_id} = 11) --11 is Diego
            ORDER BY odts.created_at DESC;
            `
        );
        res.json({
            odts
        });
    }
