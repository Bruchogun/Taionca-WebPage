const { test, expect } = require('@playwright/test');
const { login } = require('../helpers/app');
const fs = require('fs');
const routes = fs.readdirSync('src/routes').filter(file=>file.endsWith('.svelte') && !file.startsWith('_') && !['login.svelte'].includes(file))
    .map(file=>file==='index.svelte'?'/':'/'+file.replace('.svelte',''));
for (const route of routes) {
    test('page renders without runtime errors: '+route, async ({page})=>{
        await login(page.request);
        const errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        page.on('response',r=>{if(r.url().includes('/api/') && r.status()>=500)errors.push('HTTP '+r.status()+' '+new URL(r.url()).pathname);});
        const pending = new Set();
        page.on('request', r=>{if(r.url().includes('/api/')) pending.add(r);});
        page.on('requestfinished', r=>pending.delete(r));
        page.on('requestfailed', r=>{pending.delete(r); if(r.url().includes('/api/'))errors.push('Failed request '+new URL(r.url()).pathname);});
        const needsAccess=route!=='/about';
        const sessionReady=needsAccess?page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/access'):Promise.resolve();
        const response=await page.goto(route);
        expect(response.status()).toBe(200);
        await sessionReady;
        await expect.poll(()=>pending.size).toBe(0);
        await expect(page.locator('#main-content')).toBeAttached();
        expect(errors).toEqual([]);
    });
}
