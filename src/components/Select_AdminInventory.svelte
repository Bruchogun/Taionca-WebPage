<script>
	import SelectSearch from '../components/Select.svelte';

    export let recurrentExpense;
    export let id_currency=null;
	/** @type {"vertical" | "horizontal"}*/
	import { onMount } from 'svelte';
	import { apiFetch } from '../functions';
	
	/**
	 * Get recurrentExpenses, If needed
	 */
    let recurrentExpenses = [];
	onMount(async ()=>{
		 ({recurrentExpenses} = await apiFetch('/api/public/recurrentExpenses'));
	})
	
	let recurrentExpensesToList = [];
	$: if (recurrentExpenses.length > 0) {
        recurrentExpensesToList = recurrentExpenses
        .filter((recurrentExpense) => (recurrentExpense.id_currency === id_currency))
        .map((recurrentExpense) => {
            const {id_recurrentexpense, name, amount, symbol} = recurrentExpense;
            const recurrentExpense_amount=Number(amount).toFixed(2);
            recurrentExpense.value= id_recurrentexpense
            recurrentExpense.label= `${name} | ${symbol}.${recurrentExpense_amount}`
			return recurrentExpense
		})
	}

</script>

<SelectSearch placeholder="Opciones..." bind:selected={recurrentExpense} items={recurrentExpensesToList}/>
