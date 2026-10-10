import { allows,apiAccess,pageAccess } from '../security/access';
function pathOf(req) {return (req.originalUrl||req.url).split('?')[0];}
export function authorizeApi(req,res,next) {
    res.setHeader('Cache-Control','no-store');
    const access=apiAccess(req.method,pathOf(req));
    if(!req.user && access!=='public') {res.statusCode=401;return res.json({error:'Debes iniciar sesión.',redirect:'/login'});}
    if(!access || !allows(req.user,access)) {res.statusCode=403;return res.json({error:'No tienes permiso para esta operación.'});}
    req.authorized=true;return next();
}
export function authorizePage(req,res,next) {
    const path=pathOf(req);
    if(req.user) res.setHeader('Cache-Control','no-store');
    if(path.startsWith('/api/')) return next();
    const access=pageAccess(path);
    if(!access) return next(); // Sapper supplies the 404 for unknown pages.
    if(access!=='public') res.setHeader('Cache-Control','no-store');
    if(allows(req.user,access)) return next();
    res.setHeader('Cache-Control','no-store');
    if(!req.user) {res.statusCode=302;res.setHeader('Location','/login');return res.end();}
    res.statusCode=403;res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><title>Acceso restringido</title><main><h1>Acceso restringido</h1><p>Tu rol no permite acceder a esta página.</p><a href="/attendance">Volver a mi asistencia</a></main></html>');
}
export function csrf(req,res,next) {
    if(['GET','HEAD','OPTIONS'].includes(req.method)) return next();
    const origin=req.headers.origin;
    if(origin) {
        let valid=false;
        try {valid=new URL(origin).host===req.headers.host && ['http:','https:'].includes(new URL(origin).protocol);}catch(_){}
        if(!valid) {res.statusCode=403;return res.json({error:'El origen de la solicitud no está permitido.'});}
    }
    if(['POST','PATCH','PUT'].includes(req.method) && !/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) {
        res.statusCode=415;return res.json({error:'Envía los datos en formato JSON.'});
    }
    return next();
}
