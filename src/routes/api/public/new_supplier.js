import { compose } from "compose-middleware";
import { query } from "../../../db";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

export const post =
    async (req, res) => {
        const { name, phone_number1, phone_number2, email, address, description } = req.body;
        const {rows: suppliers} = await query(
            `INSERT INTO public.suppliers
                ( name, phone_number1, phone_number2, email, address, description )
                VALUES ($1::character varying, $2::character varying, $3::character varying, $4::character varying, $5::character varying, $6::character varying)
                RETURNING id_supplier;
            `, [ name, phone_number1, phone_number2, email, address, description ]
        );

        let data = suppliers[0];
        res.json({
            success:"Proveedor registrado",
            data
        });
    }