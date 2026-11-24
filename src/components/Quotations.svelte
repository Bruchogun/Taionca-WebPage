<script>
	import SelectSearch from '../components/Select.svelte';

	export let quotation;
	/** @type {"vertical" | "horizontal"}*/
	import { onMount } from 'svelte';
	import { apiFetch } from '../functions';
	import { displayMoney } from '../lib/money';
	
	/**
	 * Get quotations, If needed
	 */
    let quotations = [];
	onMount(async ()=>{
		 ({quotations} = await apiFetch('/api/public/quotations'));
	})
	
	const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

	let quotationsToList = [];
	$: if (quotations.length > 0) {
		quotationsToList = quotations.map(_quotation => {
			const {id_quotation, name, created_at, amount, symbol} = _quotation;
            const date=(new Date(created_at)).toLocaleString("es-ES",options);
            const quotation_amount = displayMoney(amount, _quotation.code || symbol);
			return ({
				..._quotation,
				value: id_quotation, 
				label: `${id_quotation} | ${name} | ${symbol}${quotation_amount} | ${date}`
			})
		})
	}

</script>

<SelectSearch placeholder="Cotizaciones..." bind:selected={quotation} on:select items={quotationsToList}/>