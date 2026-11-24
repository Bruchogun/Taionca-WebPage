<script>
	import { TextInput, Button, TextArea } from "carbon-components-svelte";
	import Accounts from "../components/Accounts.svelte";
	import { apiFetch } from '../functions';
    import Entitys from '../components/Entitys.svelte';

	let account;
	let description;
	let amount;
	let entity;

	async function add_income(){
		await apiFetch("/api/public/money_incomes",{
			method: 'POST',
			body: JSON.stringify({
				id_account: account.id_account,
				id_entity: entity.value,
				amount,
				description
			}),
			headers: {'Content-Type': 'application/json'}
		})
		cleanWindows()
	}

	function cleanWindows(){
		amount=null;
		account=null;
		entity=null;
		description="";
	}
</script>

<TextInput type="Number" labelText="Ingreso total" placeholder="Ingrese el ingreso total..." bind:value={amount}/>

<Entitys bind:entity={entity}/>

<Accounts orientation="vertical" bind:account={account}/>

<TextArea labelText="Descripción" placeholder="Ingrese la descripción del gasto..." bind:value={description}/>

<Button on:click={add_income}>Enviar</Button>