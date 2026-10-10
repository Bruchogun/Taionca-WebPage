import { sql } from '../../../db';
import { safeOdtExpense } from '../../../lib/odt-expense-errors';
import { compose } from "compose-middleware";
import { USERS_READ } from "../../../constants/PERMISSIONS";
import { getRate } from "../../../functions";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

export const post = safeOdtExpense(
    async (req, res) => {
        const { user_id } = req.session.user;
        const { id_account, id_odt, amount, description, odt_currency_code, expense_currency_code, id_measure, quantity } = req.body;
        const rate = await getRate(odt_currency_code, expense_currency_code)
        const {rows: general_expenses} = await sql`


            WITH _t as (
                UPDATE limit_resources
                SET amount = amount - ${amount}
                WHERE id_account = ${id_account} AND id_odt = ${id_odt}
            ), new_general_expense as (
                INSERT INTO public.general_expenses
                    ( id_account, id_odt, amount, description, rate, id_measure, quantity, id_user )
                    VALUES ( ${id_account}::integer, ${id_odt}::integer, ${amount}::decimal, ${description}::character varying, ${rate}::decimal, ${id_measure}::integer, ${quantity}::decimal, ${user_id}::integer)
                    RETURNING id_general_expense
            )
            SELECT alter_balance(id_balance, ${'-'+amount}, id_general_expense, 'general_expenses')
            FROM new_general_expense, balances
            WHERE id_account = ${id_account}
            AND id_entity = 1;

            `;
        
        let data = general_expenses[0]
        res.json({
            success:"Gasto realizado",
            data
        });
    });
