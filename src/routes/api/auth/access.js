import { allows,pageAccess } from '../../../security/access';
export const get=(req,res)=>{
    const url=new URL(req.originalUrl,'http://local');
    const path=url.searchParams.get('path')||'/';
    const access=pageAccess(path);
    const allowed=access?allows(req.user,access):true;
    if(!allowed) res.statusCode=403;
    res.json({allowed,session:req.user});
};
