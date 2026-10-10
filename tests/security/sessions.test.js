const {test,expect}=require('@playwright/test');
const {query,login}=require('../helpers/app');
const {workerUser,client}=require('../helpers/security');
test.beforeEach(async()=>{await workerUser();await query('DELETE FROM login_attempts');});
test('inicio de sesión rota identificador; cookie anterior y logout no permiten reutilizar acceso',async({request,playwright})=>{
 await login(request);const previous=await request.storageState();await login(request);const current=await request.storageState();expect(current.cookies.find(c=>c.name==='sessionId').value).not.toBe(previous.cookies.find(c=>c.name==='sessionId').value);
 const stale=await playwright.request.newContext({baseURL:process.env.PLAYWRIGHT_TEST_BASE_URL,storageState:previous});try{expect((await stale.get('/api/user')).status()).toBe(401);}finally{await stale.dispose();}
 const cookie=current.cookies.find(c=>c.name==='sessionId');expect(cookie.httpOnly).toBe(true);expect(cookie.sameSite).toBe('Strict');
 await request.delete('/api/user');const replay=await playwright.request.newContext({baseURL:process.env.PLAYWRIGHT_TEST_BASE_URL,storageState:current});try{expect((await replay.get('/api/user')).status()).toBe(401);}finally{await replay.dispose();}
});
test('cambiar contraseña invalida las otras sesiones y conserva una sesión renovada',async({playwright})=>{
 const a=await client(playwright),b=await client(playwright);
 try{
 const before=await a.storageState();const response=await a.patch('/api/user',{data:{old_password:'test-admin-odt',new_password:'Security-changed-123'}});expect(response.status()).toBe(200);
 expect((await a.storageState()).cookies[0].value).not.toBe(before.cookies[0].value);expect((await a.get('/api/user')).status()).toBe(200);expect((await b.get('/api/user')).status()).toBe(401);
 const loginOld=await b.post('/api/public/login',{data:{username:'security-worker',password:'test-admin-odt'}});expect(loginOld.status()).toBe(401);
 expect((await b.post('/api/public/login',{data:{username:'security-worker',password:'Security-changed-123'}})).status()).toBe(200);
 await a.patch('/api/user',{data:{old_password:'Security-changed-123',new_password:'test-admin-odt'}});
 }finally{await a.dispose();await b.dispose();await query("UPDATE users SET password_hash=(SELECT password_hash FROM users WHERE user_id=201) WHERE username='security-worker'");}
});
test('origen externo y formulario tradicional no pueden ejecutar escrituras autenticadas',async({request})=>{
 await login(request);
 for(const origin of ['https://externo.test','null'])expect((await request.post('/api/public/create_account',{headers:{origin},data:{name:'No crear',id_currency:1}})).status()).toBe(403);
 expect((await request.post('/api/public/create_account',{form:{name:'No crear',id_currency:1}})).status()).toBe(415);
 expect((await request.delete('/api/user',{headers:{origin:'https://externo.test'}})).status()).toBe(403);expect((await request.get('/api/user')).status()).toBe(200);
 expect(await query("SELECT * FROM accounts WHERE name='No crear'")).toEqual([]);
});
test('credenciales incorrectas no revelan existencia y los intentos repetidos se limitan',async({request})=>{
 const wrong=await request.post('/api/public/login',{data:{username:'security-worker',password:'wrong'}});const absent=await request.post('/api/public/login',{data:{username:'nonexistent-security-user',password:'wrong'}});
 expect(wrong.status()).toBe(401);expect(await wrong.json()).toEqual(await absent.json());
 for(let i=0;i<4;i++)expect((await request.post('/api/public/login',{data:{username:'security-worker',password:'wrong'}})).status()).toBe(401);
 const limited=await request.post('/api/public/login',{data:{username:'security-worker',password:'wrong'}});expect(limited.status()).toBe(429);expect(limited.headers()['retry-after']).toBe('900');
 expect((await request.get('/api/user')).status()).toBe(401);
});
test('rutas API desconocidas se deniegan por defecto',async({request})=>{
 expect((await request.post('/api/not-registered',{data:{}})).status()).toBe(401);await login(request);expect((await request.post('/api/not-registered',{data:{}})).status()).toBe(403);
});
