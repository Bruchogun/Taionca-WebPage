<script>
    import 'carbon-components-svelte/css/white.css';
    import { FluidForm,TextInput,Button,PasswordInput } from 'carbon-components-svelte';
    import Login32 from 'carbon-icons-svelte/lib/Login32';
    import { goto } from '@sapper/app';
    import { session } from '../stores';
    import { api } from '../functions';
    let username='',password='',saving=false;
    async function login(event) {
        event.preventDefault();if(saving) return;saving=true;
        try {
            const result=await api.post('/api/public/login',{username,password});
            $session=result.session;password='';await goto(result.session.is_admin||result.session.capabilities.includes('finance.read')?'/':'/attendance');
        } catch(error) { /* apiFetch shows the validation message. */ } finally {saving=false;}
    }
</script>
<FluidForm on:submit={login}>
    <TextInput name="username" labelText="Usuario" placeholder="Ingrese su usuario..." bind:value={username}/>
    <PasswordInput labelText="Contraseña" placeholder="Ingrese su contraseña..." bind:value={password}/>
    <Button type="submit" disabled={saving || !username || !password} icon={Login32}>Iniciar sesión</Button>
</FluidForm>
