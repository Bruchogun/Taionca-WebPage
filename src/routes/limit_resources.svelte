<script>
    import 'carbon-components-svelte/css/white.css';
	import { tick } from 'svelte';
    import { Column, DataTable, Grid, Row, TextInput} from "carbon-components-svelte";
	import { apiFetch } from '../functions';
    import Button from 'carbon-components-svelte/src/Button/Button.svelte';
    import Accounts from '../components/Accounts.svelte';
    import Odts from '../components/Odts.svelte';

	let odt;
	let label = '';
	let account;
	let amount;
	let limit_resources;
	let limit_resources_filtered;
	let rows;

	async function update_limit_resources(amount, id_account){
		await apiFetch("/api/public/update_limit_resources",{
			method: 'POST',
			body: JSON.stringify({
				id_odt: odt.id_odt,
				id_account,
				amount
			}),
			headers: {'Content-Type': 'application/json'}
		});
        await get_limit_resources();
	}

	async function get_limit_resources(){
		({limit_resources} = await apiFetch('/api/public/get_limit_resources'));
		await tick();
		limit_resources_filtered = limit_resources.filter(({id_odt}) => id_odt === odt.id_odt);
		set_chart_data();
	}

	function on_select_account(){
		if(odt){
			set_chart_data();
		}
		label = account.name_plural;
	}

	const headers = [
			{ key: 'account', value: 'Cuenta' }, 
			{ key: 'amount', value: 'Monto' }
    ]

	function set_chart_data(){
		rows = limit_resources_filtered.map(( limit_resource ) => {
			return ({
				id: limit_resource.id_limit_resource,
				account: `${limit_resource.name} (${limit_resource.symbol})`,
				amount: `${Number(limit_resource.amount).toFixed(2)} ${limit_resource.symbol}`
			})
		})
	}

</script>

<Grid narrow>
	<Row>
		<Column padding style="outline: 1px solid var(--cds-interactive-04)">
			<Odts bind:odt={odt} on:select={get_limit_resources}/>
		</Column>
		<Column padding style="outline: 1px solid var(--cds-interactive-04)">
			<Accounts on:select={on_select_account} orientation="vertical" bind:account={account}/>
		</Column>
	</Row>
	<Row>
		<Column padding style="outline: 1px solid var(--cds-interactive-04)">
			<TextInput bind:value={amount} type="number" labelText="Monto límite en {label}" placeholder="Ingrese el monto..." />
		</Column>
		<Column padding style="outline: 1px solid var(--cds-interactive-04)">
			<Button on:click={update_limit_resources(amount, account.id_account)}>Actualizar</Button>
		</Column>
	</Row>
</Grid>

{#if odt}
	<DataTable size="short" title="Recursos disponibles" sortable {headers} {rows}/>
{/if}
