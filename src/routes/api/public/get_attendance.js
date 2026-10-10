import { sql } from "../../../db";

// List attendances
export const get =
    async (req, res) => {
        const {user_id} = req.session.user;
        const {rows: attendances} = await sql`
        
            SELECT 
                id_attendance, 
                attendances.id_user, 
                entry_date, 
                departure_date, 
                users.name, 
                users.lastname,
                users.user_id as id_user,
                attendances.created_at

            FROM attendances
            JOIN users ON users.user_id = attendances.id_user
            WHERE (${req.user.is_admin || req.user.capabilities.includes('attendance.read_all')} OR attendances.id_user = ${user_id})
            ORDER BY id_attendance DESC;
                
            `;

        res.json({
            attendances,
            user_id
        });
    }
