const {test,expect}=require('@playwright/test');
const {login}=require('../helpers/app');
const fs=require('fs'),vm=require('vm');
test('HTML privado y API no se almacenan en caché aunque exista sesión válida',async({request})=>{
 await login(request);for(const path of ['/administracion_permisos','/attendance','/','/about','/blog','/api/user','/api/admin/security'])expect((await request.get(path)).headers()['cache-control'],path).toBe('no-store');
});
test('service worker solo sirve archivos estáticos y elimina cachés privadas antiguas',async()=>{
 const handlers={},deleted=[],served=[],cached=[];let claimed=false;
 const code=fs.readFileSync('src/service-worker.js','utf8').replace(/^import[^;]+;/,"const timestamp='current',files=['/favicon.png'],shell=['/client.js'];");
 const context={URL,self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{claimed=true;}}},caches:{open:async()=>({addAll:async a=>cached.push(...a)}),keys:async()=>['cacheold','offlineold','cachecurrent'],delete:async key=>deleted.push(key),match:async req=>{served.push(req.url);return 'asset';}},fetch:()=>{throw Error('Unexpected fetch');}};
 vm.runInNewContext(code,context);
 let wait;handlers.install({waitUntil:p=>wait=p});await wait;expect(cached).toEqual(['/client.js','/favicon.png']);handlers.activate({waitUntil:p=>wait=p});await wait;expect(deleted).toEqual(['cacheold','offlineold']);expect(claimed).toBe(true);
 for(const path of ['/','/attendance','/administracion_permisos','/api/user','/api/public/odt_payments/1','/auth.json']){
 let intercepted=false;handlers.fetch({request:{method:'GET',url:'https://example.test'+path,headers:{has:()=>false}},respondWith:()=>intercepted=true});expect(intercepted,path).toBe(false);
 }
 handlers.fetch({request:{method:'GET',url:'https://example.test/client.js',headers:{has:()=>false}},respondWith:p=>wait=p});expect(await wait).toBe('asset');expect(served).toEqual(['https://example.test/client.js']);
});
