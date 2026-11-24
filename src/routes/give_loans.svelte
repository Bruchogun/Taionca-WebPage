<script>
	import {TextInput,  TextArea, Button} from "carbon-components-svelte";
	import Accounts from  "../components/Accounts.svelte";
	import { apiFetch } from '../functions';
    import Users from '../components/Users.svelte';
	
	let user;
	let account;
	let description;
	let amount;

	async function create_expense(){
		await apiFetch("/api/public/give_loan",{
			method: 'POST',
			body: JSON.stringify({
				user,
				account,
				description,
				amount
			}),
			headers: {'Content-Type': 'application/json'}
		})
		cleanWindows()
	}

	function cleanWindows(){
		user = null
		amount = null
		account = null
		description = ""
	}
</script>

	<Users bind:user={user}/>

	<TextInput type="Number" labelText="Monto" placeholder="Monto a prestar..." bind:value={amount}/>

	<Accounts orientation="vertical" bind:account={account}/>

	<TextArea labelText="Descripción" placeholder="Ingrese la descripción del préstamo..." bind:value={description}/>

	<Button on:click={create_expense}>Enviar</Button>