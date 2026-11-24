<script>
    import { FluidForm, TextInput, Button, PasswordInput } from 'carbon-components-svelte';
    import Login32 from 'carbon-icons-svelte/lib/Login32';
    import { onMount } from 'svelte';
    import { goto } from '@sapper/app';
    import { session } from '../stores';
    import { api } from '../functions';

    let ready = false;
    let saving = false;
    onMount(() => { ready = true; });

    async function login(event) {
        event.preventDefault();
        if (!ready || saving) return;

        const form = event.currentTarget;
        const fields = new FormData(form);
        saving = true;
        try {
            const result = await api.post('/api/public/login', {
                username: fields.get('username'),
                password: fields.get('password')
            });
            $session = result.session;
            form.elements.namedItem('password').value = '';
            await goto(result.session.is_admin || result.session.capabilities.includes('finance.read') ? '/' : '/attendance');
        } catch (error) {
            // apiFetch shows the validation message.
        } finally {
            saving = false;
        }
    }
</script>

<FluidForm method="post" on:submit={login}>
    <TextInput name="username" autocomplete="username" required disabled={!ready}
        labelText="Usuario" placeholder="Ingrese su usuario..."/>
    <PasswordInput name="password" autocomplete="current-password" required disabled={!ready}
        labelText="Contraseña" placeholder="Ingrese su contraseña..." tooltipAlignment="end"
        showPasswordLabel="Mostrar contraseña" hidePasswordLabel="Ocultar contraseña"/>
    <Button type="submit" disabled={!ready || saving} icon={Login32}>Iniciar sesión</Button>
</FluidForm>
