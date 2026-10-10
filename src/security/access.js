import policy from './policy.json';
export { policy };
export function allows(user,access) {
    if(access==='public') return true;
    if(!user) return false;
    if(access==='authenticated') return true;
    if(access==='admin') return !!user.is_admin;
    if(user.is_admin) return true;
    return Array.isArray(access) && access.some(key=>(user.capabilities||[]).includes(key));
}
export function pageAccess(path) {
    const clean=path.split('?')[0].replace(/\/$/,'')||'/';
    if(clean==='/blog'||clean.startsWith('/blog/')) return 'public';
    return policy.pages[clean];
}
export function apiAccess(method,path) {
    const clean=path.split('?')[0].replace(/\/$/,'');
    const match=policy.api.find(route=>route.method===method && new RegExp('^'+route.path.replace(/:[^/]+/g,'[^/]+')+'$').test(clean));
    return match && match.access;
}
export function canPage(user,path){return allows(user,pageAccess(path));}
