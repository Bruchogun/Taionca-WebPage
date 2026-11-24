<script>
	import {TextInput,  TextArea, Button, DataTable} from "carbon-components-svelte";
	import Accounts from  "../components/Accounts.svelte";
	import { apiFetch } from '../functions';
	import { amountColumn } from '../lib/money-table';
    import Users from '../components/Users.svelte';
	
	let user;
	let account;
	let amount;
	let rows;
	let loans;

	async function create_expense(){
		await apiFetch("/api/public/pay_loan",{
			method: 'POST',
			body: JSON.stringify({
				user,
				account,
				description: "Abono a la deuda.",
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
		rows = null;
	}

	async function get_loans(){
		({loans} = await apiFetch('/api/public/loans'));
		let loans_filtered = loans.filter(({id_user}) => id_user === user.value);
		rows = loans_filtered.map(loan => ({
			id: loan.id_loan,
			currency: loan.name_plural.replace(/(^|\s)\S/g, l => l.toUpperCase()),
			amount: { value: loan.amount, currency: loan.code, symbol: loan.symbol }
		}));
	}

    //HEADERS
	let headers = [
	{ key: "currency", value: "Moneda"  },
    { ...amountColumn, value: "Saldo adeudado" }
	];

</script>

	<Users bind:user={user} on:select={get_loans}/>

	<TextInput type="Number" labelText="Monto" placeholder="Monto a abonar..." bind:value={amount}/>

	<Accounts orientation="vertical" bind:account={account}/>

	<Button on:click={create_expense}>Enviar</Button>

	{#if rows}<DataTable size="short" title="Deudas" sortable {headers} {rows} />{/if}
