import { query } from "../../../db";

// List loans
export const get =
    async (req, res) => {

        const {rows: loans} = await query(
            `select *
            from loans
            join currencys using (id_currency) WHERE ($1::boolean OR id_user=$2);
            `, [req.user.is_admin || req.user.capabilities.includes('finance.loans') || req.user.capabilities.includes('finance.read'), req.user.user_id]
        );

        res.json({
            loans
        });
    }
