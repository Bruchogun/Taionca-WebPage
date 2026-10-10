import argon2 from "argon2";
import { argon as config } from "../../../config";
import { query } from "../../../db";

// Get profile
export async function get (req, res) {
    const {user_id} = req.session.user;
    const {rows: permissions} = await query(
        `SELECT
            permission_id,
            permissions.name
        FROM join_users_roles
        JOIN join_roles_permissions USING (role_id)
        JOIN permissions USING (permission_id)
        WHERE user_id = $1 AND permissions.deleted_at IS NULL
        GROUP BY permission_id, permissions.name
        ORDER BY permission_id;`,
        [user_id]
    );

    res.json({permissions});
}