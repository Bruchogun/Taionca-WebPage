import { compose } from "compose-middleware";
import { query } from "../../../db";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

export const post =
    async (req, res) => {
        const { name, description, importance, time_frequency, days } = req.body;
        if (days){
            var {rows: recurrent_responsibilitys} = await query(
                `INSERT INTO public.recurrent_responsibilitys
                    ( name, description, importance, id_time_frequency, days_to_repeat )
                    VALUES ($1::character varying, $2::character varying, $3::integer, $4::integer, $5::integer)
                    RETURNING id_recurrent_responsibility;
                `, [ name, description, importance, time_frequency.id_time_frequency, days ]
            );
        }else{
            var {rows: recurrent_responsibilitys} = await query(
                `INSERT INTO public.recurrent_responsibilitys
                    ( name, description, importance, id_time_frequency )
                    VALUES ($1::character varying, $2::character varying, $3::integer, $4::integer)
                    RETURNING id_recurrent_responsibility;
                `, [ name, description, importance, time_frequency.id_time_frequency ]
            );
        }

        let data = recurrent_responsibilitys[0]
        res.json( {
            data,
            success:"Responsabilidad registrada"
        });
    }