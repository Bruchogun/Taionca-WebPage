import { identity } from '../security/identity';
export default async(req,res,next)=>{
    try {
        const previous=req.session.user;
        req.user=null;
        if(previous) {
            const current=await identity(previous.user_id);
            // Old sessions have no version and are deliberately invalidated on migration.
            if(current && current.session_version===previous.session_version) {
                req.user=current;req.session.user=current;
            }else delete req.session.user;
        }
        next();
    }catch(error){res.statusCode=503;res.json({error:'No se pudo verificar la sesión. Inténtalo nuevamente.'});}
};
