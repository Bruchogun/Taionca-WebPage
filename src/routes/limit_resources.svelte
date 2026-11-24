<script>
    import { Column, DataTable, Grid, Row, TextInput} from "carbon-components-svelte";
	import { apiFetch } from '../functions';
	import { compareMoney, displayMoney } from '../lib/money';
    import Button from 'carbon-components-svelte/src/Button/Button.svelte';
    import Accounts from '../components/Accounts.svelte';
    import Odts from '../components/Odts.svelte';

	let odt;
	let account;
	let amount;
	let limitResources = [];
	let loadVersion = 0;
	let saving = false;

	$: label = account?.name_plural || '';
	$: canUpdate = !!odt && !!account && amount != null && amount !== '';
	$: rows = odt ? limitResources.filter(resource => resource.id_odt === odt.id_odt).map(resource => ({
		id: resource.id_limit_resource,
		account: `${resource.name} (${resource.symbol})`,
		amount: resource.amount,
		code: resource.code,
		symbol: resource.symbol
	})) : [];

	async function updateLimitResources() {
		if (!canUpdate || saving) return;
		saving = true;
		try {
			await apiFetch('/api/public/update_limit_resources', {
				method: 'POST',
				body: JSON.stringify({ id_odt: odt.id_odt, id_account: account.id_account, amount }),
				headers: { 'Content-Type': 'application/json' }
			});
			await getLimitResources();
		} catch {
			// apiFetch displays the error.
		} finally {
			saving = false;
		}
	}

	async function getLimitResources() {
		const version = ++loadVersion;
		try {
			const { limit_resources } = await apiFetch('/api/public/get_limit_resources');
			if (version === loadVersion) limitResources = limit_resources;
		} catch {
			if (version === loadVersion) limitResources = [];
		}
	}

	const headers = [
			{ key: 'account', value: 'Cuenta' }, 
			{ key: 'amount', value: 'Monto', sort: compareMoney }
    ]

</script>

<Grid narrow>
	<Row>
		<Column padding style="outline: 1px solid var(--cds-interactive-04)">
			<Odts bind:odt={odt} on:select={getLimitResources}/>
		</Column>
		<Column padding style="outline: 1px solid var(--cds-interactive-04)">
			<Accounts orientation="vertical" bind:account={account}/>
		</Column>
	</Row>
	<Row>
		<Column padding style="outline: 1px solid var(--cds-interactive-04)">
			<TextInput bind:value={amount} type="number" labelText="Monto límite en {label}" placeholder="Ingrese el monto..." />
		</Column>
		<Column padding style="outline: 1px solid var(--cds-interactive-04)">
			<Button disabled={!canUpdate || saving} on:click={updateLimitResources}>Actualizar</Button>
		</Column>
	</Row>
</Grid>

{#if odt}
	<DataTable size="short" title="Recursos disponibles" sortable {headers} {rows}>
		<span slot="cell" let:cell let:row>
			{#if cell.key === 'amount'}{displayMoney(cell.value, row.code || row.symbol)} {row.symbol}{:else}{cell.value}{/if}
		</span>
	</DataTable>
{/if}
