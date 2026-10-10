import { safeOdtExpense } from '../../../lib/odt-expense-errors';
import { sql } from '../../../db';
import { compose } from "compose-middleware";
import { USERS_READ } from "../../../constants/PERMISSIONS";
import { getRate } from "../../../functions";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

export const post = safeOdtExpense(
    async (req, res) => {
        const { user_id } = req.session.user;
        const { id_account, id_entity, amount, description } = req.body;
        const {rows: investments} = await sql`

            WITH _t as (
                INSERT INTO public.investments
                    ( id_user, id_account, id_entity, amount, description )
                    VALUES ( ${user_id}::integer, ${id_account}::integer, ${id_entity}::integer, ${amount}::decimal, ${description}::character varying )
                    RETURNING id_investment
            )
            SELECT alter_balance(id_balance, ${'-'+amount}, id_investment, 'investments')
                FROM _t, balances
                WHERE id_account = ${id_account}
                AND id_entity = ${id_entity};

            `;
        
        let data = investments[0]
        res.json({
            success:"Inversion registrada.",
            data
        });
    });
