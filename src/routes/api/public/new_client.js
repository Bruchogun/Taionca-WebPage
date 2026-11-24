import { compose } from "compose-middleware";
import { query } from "../../../db";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

export const post =
    async (req, res) => {
        const { name, phone_number1, phone_number2, email, address, description, legal_id } = req.body;
        const {rows: clients} = await query(
            `INSERT INTO public.clients
                ( name, phone_number1, phone_number2, email, address, description, legal_id )
                VALUES ($1::character varying, $2::character varying, $3::character varying, $4::character varying, $5::character varying, $6::character varying, $7::character varying)
                RETURNING id_client;
            `, [ name, phone_number1, phone_number2, email, address, description, legal_id ]
        );

        let data = clients[0]
        res.json( {
            data,
            success:"Cliente registrado" 
        });
    }