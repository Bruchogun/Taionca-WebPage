<script>
	import SelectSearch from './Select.svelte';

	export let odt;
	export let is_filtered = false;
	export let start_date;
	export let end_date;
	/** @type {"vertical" | "horizontal"}*/
	import { onMount } from 'svelte';
	import { apiFetch } from '../functions';
	import { displayMoney } from '../lib/money';
	
	/**
	 * Get odts, If needed
	 */
    let odts = [];
	onMount(async ()=>{
		 ({odts} = await apiFetch('/api/public/closed_odts'));
	})
	
	let odtsToList = [];
	$: if (odts.length > 0) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
		odtsToList = odts.map(odt => {
			const {id_odt, name, created_at, amount, symbol} = odt;
            const date=(new Date(created_at)).toLocaleString("es-ES",options);
            const odt_amount = displayMoney(amount, odt.code || symbol);
			return ({
				...odt,
				value: id_odt, 
				label: `${id_odt} | ${odt.user_name} | ${name} | ${symbol}${odt_amount}`
			})
		})
		if(is_filtered){
			odtsToList = odtsToList.filter(odt => new Date(odt.closed_at) >= new Date(start_date) && new Date(odt.closed_at) <= new Date(end_date));
		}
	}

</script>

<SelectSearch placeholder="Odts cerradas..." inputAttributes={{ 'aria-label': 'Seleccionar ODT cerrada' }} bind:selected={odt} items={odtsToList} on:select {is_filtered} {start_date} {end_date}/>