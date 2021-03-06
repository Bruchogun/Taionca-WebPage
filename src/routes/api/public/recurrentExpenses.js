import { query } from "../../../db";

// List recurrentExpenses
export const get =
    async (req, res) => {

        const {rows: recurrentExpenses} = await query(
            `select *
            from recurrentExpenses
            join currencys using(id_currency);`
        );

        res.json({
            recurrentExpenses
        });
    }
