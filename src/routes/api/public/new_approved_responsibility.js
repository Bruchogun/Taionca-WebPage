import { transaction,invalid } from '../../../lib/api-transaction';
import { nextResponsibility } from '../../../lib/responsibilities';
export const post=transaction(async(req,client)=>{
 // Lock the assignment first so approvals and recurrence updates share the same lock order.
 await client.query(`SELECT a.id_active_responsibility FROM active_responsibilitys a JOIN pending_responsibilitys p USING(id_active_responsibility)
   JOIN awaiting_approval_responsibilitys w USING(id_pending_responsibility) WHERE id_awaiting_approval_responsibility=$1 FOR UPDATE OF a`,[req.body.id_awaiting_approval_responsibility]);
 const row=(await client.query(`SELECT w.*,p.id_active_responsibility,p.deadline,a.id_recurrent_responsibility,a.id_user FROM awaiting_approval_responsibilitys w
   JOIN pending_responsibilitys p USING(id_pending_responsibility) JOIN active_responsibilitys a USING(id_active_responsibility)
   WHERE id_awaiting_approval_responsibility=$1 FOR UPDATE OF w`,[req.body.id_awaiting_approval_responsibility])).rows[0];
 if(!row) invalid('Esta responsabilidad ya no está pendiente de aprobación.',409);
 await nextResponsibility(client,row);
 const completed=(await client.query(`INSERT INTO completed_responsibilitys(id_recurrent_responsibility,id_user_who_made,id_user_who_approved,description_evidence,created_at)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,[row.id_recurrent_responsibility,row.id_user,req.session.user.user_id,row.description_evidence,row.created_at])).rows[0];
 await client.query('DELETE FROM pending_responsibilitys WHERE id_pending_responsibility=$1',[row.id_pending_responsibility]);
 return {success:'Responsabilidad aprobada.',completed_responsibility:completed};
});
