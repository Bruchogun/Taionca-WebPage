import { transaction,invalid } from '../../lib/api-transaction';
import argon2 from "argon2";
import { argon as config } from "../../config";
import { compose } from "compose-middleware";
import { USERS_READ } from "../../constants/PERMISSIONS";
import checkPermissionsMW from "../../middlewares/checkPermissionsMW";
import { query } from "../../db";

// List users
export const get = compose(
    checkPermissionsMW(USERS_READ),
    async (req, res) => {

        const {rows: users} = await res.sql`
            SELECT
                user_id,
                users.name,
                users.created_at,
                CASE WHEN COUNT(role_id) > 0
                    THEN
                        array_agg(jsonb_build_object(
                            'role_id', role_id,
                            'name', roles.name)
                        )
                    ELSE 
                        '{}'
                END AS roles
            FROM users
            LEFT JOIN join_users_roles USING (user_id)
            LEFT JOIN roles USING (role_id)
            WHERE special_user = FALSE
            GROUP BY user_id;
        `;

        res.json({
            users,
        });
    }
)

// Signup
export const post = transaction(async(req,client)=>{
    const {password,name,email,lastname}=req.body;
    const username=typeof req.body.username==='string'?req.body.username.trim().toLowerCase():'';
    if(!username || typeof password!=='string' || !password || !name || !email || !lastname) invalid('Complete usuario, contraseña, nombre, apellido y correo.');
    const hash=await argon2.hash(password,config);
    await client.query(`WITH new_entity AS (
        INSERT INTO entitys(name) VALUES($1) RETURNING id_entity
    ), new_balances AS (
        INSERT INTO balances(id_account,id_entity) SELECT id_account,id_entity FROM accounts,new_entity
    ) INSERT INTO users(username,password_hash,name,email,lastname,id_entity)
        SELECT $1,$2,$3,$4,$5,id_entity FROM new_entity`,[username,hash,name,email,lastname]);
    return {success:'Usuario creado exitosamente'};
});
