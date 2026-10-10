import { safeOdtExpense } from '../../../lib/odt-expense-errors';
import { compose } from "compose-middleware";
import { USERS_READ } from "../../../constants/PERMISSIONS";
import { sql } from "../../../db";
import { getRate } from "../../../functions";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

// Rate based in dollars

export const post = safeOdtExpense(
    async (req, res) => {
        const { user_id } = req.session.user;
        const { id_account, amount, description, expense_currency_code } = req.body;
        const rate = await getRate('usd', expense_currency_code);
        const {rows: admin_expenses} = await sql`

            WITH new_admin_expense as (
                INSERT INTO public.admin_expenses
                    ( id_account,  amount, description, rate, id_user)
                    VALUES ( ${id_account}::integer,  ${amount}::decimal(30,10), ${description}::character varying, ${rate}::decimal(30,10), ${user_id}::integer)
                    RETURNING id_admin_expense
            )
            SELECT alter_balance(id_balance, ${'-'+amount}::decimal(30,10), id_admin_expense, 'admin_expenses')
            FROM new_admin_expense, balances
            WHERE id_account = ${id_account}
                AND id_entity = 2
            ;
        `;

        let data = admin_expenses[0]
        res.json({
            success: "Gasto realizado",
            data
        });
    });
