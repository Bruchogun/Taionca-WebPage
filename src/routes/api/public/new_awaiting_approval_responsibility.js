import { transaction,invalid } from '../../../lib/api-transaction';
export const post=transaction(async(req,client)=>{
 const {id_pending_responsibility,description_evidence}=req.body;
 if(typeof description_evidence!=='string'||!description_evidence.trim()) invalid('Incluya la evidencia de la responsabilidad.');
 const pending=(await client.query('SELECT p.*,a.id_user FROM pending_responsibilitys p JOIN active_responsibilitys a USING(id_active_responsibility) WHERE id_pending_responsibility=$1',[id_pending_responsibility])).rows[0];
 if(!pending) invalid('Responsabilidad pendiente no encontrada.',404);
 if(pending.id_user!==req.session.user.user_id) invalid('Solo la persona asignada puede enviar esta responsabilidad.',403);
 const {rows}=await client.query('INSERT INTO awaiting_approval_responsibilitys(id_pending_responsibility,description_evidence) VALUES($1,$2) RETURNING *',[id_pending_responsibility,description_evidence]);
 return {success:'Responsabilidad enviada para su revisión.',awaiting_approval_responsibilitys:rows};
});
