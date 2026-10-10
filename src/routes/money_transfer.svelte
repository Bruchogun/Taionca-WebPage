<script>
	import { Button, TextArea, TextInput } from "carbon-components-svelte";
	import 'carbon-components-svelte/css/white.css';
	import Accounts from "../components/Accounts.svelte";
	import Entitys from "../components/Entitys.svelte";
	import { apiFetch } from "../functions";

	let amount;
	let account_expense;
	let account_income;
	let description;
	let entity_income;
	let entity_expense

	async function create_transfer(){

		await apiFetch("/api/public/transfer_entitys",{
			method: 'POST',
			body: JSON.stringify({
				description,
				amount,
				expense: {
					id_account: account_expense.id_account,
					id_entity: entity_expense.value,
					id_currency: account_expense.id_currency
				},
				income: {
					id_account: account_income.id_account,
					id_entity: entity_income.value,
					id_currency: account_income.id_currency
				}
			}),
			headers: {'Content-Type': 'application/json'}
		})

		cleanWindows()
	}

	function cleanWindows(){
		account_expense=null;
		amount=null;
		account_income=null;
		description="";
		entity_income=null;
		entity_expense=null;
	}

</script>

<style>
	.OnSameLine{
		display: flex;
		justify-content: space-around;
	}

	.OnSameLine > :global(*){
		width: 100%;
	}

	.icons{
		font-size: 2rem;
		line-height: 2.5;
		width: 1em;
	}
</style>

<TextInput type="number" labelText="Monto a transferir" placeholder="Ingrese el monto transferir..." bind:value={amount} />

<div class="OnSameLine">
	<div>
		<Accounts orientation="vertical" bind:account={account_expense}/>
		<Entitys bind:entity={entity_expense}/>
	</div>
		<h3 class="icons">➤</h3>
	<div>
		{#if account_expense}
			<Accounts orientation="vertical" id_currency_filter={account_expense.id_currency} bind:account={account_income}/>
			<Entitys bind:entity={entity_income}/>
		{/if}
	</div>
</div>

<TextArea labelText="Descripción" placeholder="Ingrese la descripción de la transferencia..." bind:value={description}/>

<Button on:click={create_transfer}>Enviar</Button>