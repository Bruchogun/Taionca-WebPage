<script>
	import { TextInput, Button, TextArea } from "carbon-components-svelte";
	import Accounts from "../components/Accounts.svelte";
	import { apiFetch } from '../functions';
    import Entitys from '../components/Entitys.svelte';

	let account;
	let description;
	let amount;
	let entity;

	async function add_investment(){
		await apiFetch("/api/public/investments",{
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

<TextInput type="Number" labelText="Monto total" placeholder="Ingrese el monto total..." bind:value={amount}/>

<Entitys bind:entity={entity}/>

<Accounts orientation="vertical" bind:account={account}/>

<TextArea labelText="Descripción" placeholder="Ingrese la descripción del gasto..." bind:value={description}/>

<Button on:click={add_investment}>Enviar</Button>