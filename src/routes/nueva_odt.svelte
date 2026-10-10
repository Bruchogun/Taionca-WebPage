<script>
	import 'carbon-components-svelte/css/white.css';
	import { TextInput, TextArea, Button, ContentSwitcher, Switch, Column, Row } from "carbon-components-svelte";
	import Clients from "../components/Clients.svelte";
	import Currency from "../components/Currency.svelte";
	import { apiFetch } from '../functions';
	import Quotations from '../components/Quotations.svelte';
	import { tick } from 'svelte';
    import PercentInput from '../components/PercentInput.svelte';
	// import Login from './login.svelte';

	let amount;
	let client = null;
	let description;
	let id_entity=1;
	let currency;
	let quotation;
	let selectedIndex = 1;
	let id_client;
	let id_quotation;
	let id_currency;
	let admin_percent = 0.1;

	
	async function create_odt(){
		
		if(quotation && selectedIndex === 0) {
			id_client = quotation.id_client;
			id_quotation = quotation.id_quotation;
			id_currency = quotation.id_currency;
            admin_percent = quotation.admin_percent;
		}else if (client && selectedIndex === 1){
			id_client = client.value;
			id_quotation = null;
			id_currency = currency.id_currency;	
		}
		await apiFetch("/api/public/nueva_odt",{
			method: 'POST',
			body: JSON.stringify({
				id_client,
				id_currency,
				id_entity,
				amount,
				description,
				id_quotation,
				admin_percent
			}),
			headers: {'Content-Type': 'application/json'}
		})
		cleanWindows()
	}

	function cleanWindows(){
		amount=null;
		client=null;
		quotation=null;
		description="";
	}

</script>

<TextInput type="number"labelText="Monto de contrato" placeholder="Ingrese el monto del contrato..." bind:value={amount}/>

<ContentSwitcher bind:selectedIndex>
	<Switch text="Utilizar una cotización" />
	<Switch text="No utilizar una cotización" />
</ContentSwitcher>

{#if selectedIndex === 0}

	<Quotations bind:quotation={quotation} on:select={async ()=> {await tick(); amount = quotation.amount}}/>
	
{/if}
	
{#if selectedIndex === 1}
	
	<Currency bind:currency={currency}/>
	<Row>
		<Column style="outline: 1px solid var(--cds-interactive-04)">
			<h5>Porcentaje administrativo:</h5>
		</Column>
		<Column style="outline: 1px solid var(--cds-interactive-04)">
			<PercentInput bind:value={admin_percent}/>
		</Column>
	</Row>
	<Clients bind:client={client}/>

{/if}

<TextArea labelText="Descripción" placeholder="Ingrese la descripción del trabajo..." bind:value={description}/>

<Button on:click={create_odt}>Enviar</Button>