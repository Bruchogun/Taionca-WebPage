const { test, expect } = require('@playwright/test');

test('login through the page creates a session and opens the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Ingrese su usuario...').fill('admin');
    await page.getByPlaceholder('Ingrese su contraseña...').fill('test-admin-odt');
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL('/');
    expect((await page.context().cookies()).some(cookie => cookie.name === 'sessionId')).toBe(true);
    await expect(page.getByRole('button', {name:'Cerrar sesión'})).toBeVisible();
});

test('incorrect password does not create an authenticated session', async ({ request }) => {
    const response = await request.post('/api/public/login', { data: { username: 'admin', password: 'wrong-password' } });
    expect((await response.json()).error).toBe('Usuario o contraseña incorrecta.');
    expect((await request.post('/api/public/closure_odt',{data:{}})).status()).toBe(401);
});
