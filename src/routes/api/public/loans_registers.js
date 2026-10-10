import { query } from "../../../db";

// List loans_register
export const get =
    async (req, res) => {

        const {rows: loans_register} = await query(
            `select *
            from loans_registers
            join currencys using (id_currency) WHERE ($1::boolean OR id_user=$2) ORDER BY id_loans_register;
            `, [req.user.is_admin || req.user.capabilities.includes('finance.loans') || req.user.capabilities.includes('finance.read'), req.user.user_id]
        );

        res.json({
            loans_register
        });
    }
