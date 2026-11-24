<script>
	import {TextInput,  TextArea, Button} from "carbon-components-svelte";
	import Accounts from  "../components/Accounts.svelte";
	import { apiFetch } from '../functions';
	
	let account;
	let description;
	let amount;

	async function create_expense(){
		await apiFetch("/api/public/admin_expenses",{
			method: 'POST',
			body: JSON.stringify({
				id_account: account.id_account,
				id_currency: account.id_currency,
				amount,
				description,
				expense_currency_code: account.code,
			}),
			headers: {'Content-Type': 'application/json'}
		})
		cleanWindows()
	}

	function cleanWindows(){
		amount=null
		account=null
		description=""
	}
</script>	

	<TextInput type="Number" labelText="Monto" placeholder="Ingrese el monto del gasto..." bind:value={amount}/>

	<Accounts orientation="vertical" bind:account={account}/>

	<TextArea labelText="Descripción" placeholder="Ingrese la descripción del gasto..." bind:value={description}/>

	<Button on:click={create_expense}>Enviar</Button>