<script>
	import {Button} from "carbon-components-svelte";
	import Accounts from  "../components/Accounts.svelte";
	import Select_AdminInventory from  "../components/Select_AdminInventory.svelte";

	let account;
	let currency;
	let expense;
	
</script>	

    <Accounts orientation="vertical" bind:account={account} bind:currency={currency}/>
    <Select_AdminInventory orientation="vertical" id_currency={account && account.id_currency} bind:recurrentExpense={expense}/>
    <Button>Enviar</Button>