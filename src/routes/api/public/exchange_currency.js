import { safeOdtExpense } from '../../../lib/odt-expense-errors';
import { compose } from "compose-middleware";
import { USERS_READ } from "../../../constants/PERMISSIONS";
import { query } from "../../../db";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

export const post = safeOdtExpense(
    async (req, res) => {
        const {description, income, expense, id_entity} = req.body;
        if(expense.id_account === income.id_account){
            return res.json({error: "Selecciona cuentas diferentes."});
        }else if (expense.id_currency === income.id_currency){
            return res.json({error: "Seleccione cuentas con monedas diferentes."});
        }
        const {rows: currencyChange} = await query(
            `
                WITH new_exchange_currencys as (
                    INSERT INTO exchange_currencys
                        (description)
                        VALUES ($1::character varying)
                        RETURNING id_exchange_currency
                )
                SELECT alter_balance( --Maldita sea, puto alter_balance siempre de ultimo en los WITHS!!!!!! 
                    id_balance,
                    CASE WHEN id_account=$2 THEN -$3::numeric ELSE $5::numeric END,
                    id_exchange_currency,
                    'exchange_currency' 
                ) FROM balances, new_exchange_currencys
                WHERE id_account IN ($2::integer, $4::integer) AND id_entity = $6
                ;
            `, [
                description,
                expense.id_account, 
                expense.amount,
                income.id_account, 
                income.amount,
                id_entity
            ]
        );
        let data = currencyChange[0]
        res.json({
            success:"Cambio de moneda realizado",
            data
        });
    });
