<script>
	import 'carbon-components-svelte/css/white.css';
	import { FluidForm, TextInput, Button, PasswordInput } from "carbon-components-svelte";
    import { apiFetch } from '../functions';

	let user;
    let password1;
    let password2;
    let email;
    let name;
    let lastname;

    
    
    async function signup(){
		await apiFetch("/api/users",{
			method: 'POST',
			body: JSON.stringify({
                username: user.trim(),
                password: password1,
                name,
                email,
                lastname

			}),
			headers: {'Content-Type': 'application/json'}
        })
        name=null
        lastname=null
        user=null
        email=null
        password1=null
        password2=null
    }

</script>

<FluidForm>
    <TextInput type="user" labelText="Nombre" placeholder="Ingrese su nombre..." bind:value={name}/>

    <TextInput type="user" labelText="Apellido" placeholder="Ingrese su apellido..." bind:value={lastname}/>

    <TextInput type="user" labelText="Usuario" placeholder="Ingrese un usuario..." bind:value={user}/>

    <TextInput type="email" labelText="Correo" placeholder="Ingrese su correo electrónico.." bind:value={email}/>

    <PasswordInput type="password" labelText="Contraseña" placeholder="Ingrese su contraseña..." bind:value={password1}/>
    
    <PasswordInput type="password" invalid={password1 !== password2} invalidText="Las contraseñas no concuerdan." labelText="Repita Contraseña" placeholder="Ingrese su contraseña..." bind:value={password2}/>

    <Button disabled={!user || !password1 || password1 !== password2 || !name || !lastname || !email} on:click={signup}>Crear usuario</Button>
</FluidForm>