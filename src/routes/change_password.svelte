<script>
	import 'carbon-components-svelte/css/white.css';
	import { FluidForm, Button, PasswordInput } from "carbon-components-svelte";
	import { session } from '../stores';
	import { apiFetch } from '../functions';

	let old_password;
	let new_password;
	let password;

    async function update_user_info(){
		await apiFetch("/api/user",{
			method: 'PATCH',
			body: JSON.stringify({
				old_password,
				new_password
			}),
			headers: {'Content-Type': 'application/json'}
        })
		
		// const result = await response.json();
    }

 
</script>

<FluidForm>

    <PasswordInput type="password" labelText="Actual contraseña" placeholder="Ingrese su contraseña..." bind:value={old_password}/>

    <PasswordInput type="password" invalid={old_password === new_password} invalidText="La nueva contraseña debe ser diferente" labelText="Nueva contraseña" placeholder="Ingrese su contraseña..." bind:value={new_password}/>
    
    <PasswordInput type="password" invalid={new_password !== password} invalidText="Las contraseñas no concuerdan." labelText="Repita Contraseña" placeholder="Ingrese su contraseña..." bind:value={password}/>

    <Button disabled={!old_password || !new_password || new_password !== password || old_password === new_password} on:click={update_user_info}>Cambiar contraseña</Button>
</FluidForm>