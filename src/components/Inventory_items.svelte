<script>
	import { onMount } from 'svelte';
    import { DataTable, Grid, Row, Column} from "carbon-components-svelte";
	import Storages from '../components/Storages.svelte';
	import { apiFetch } from '../functions';
	import { compareMoney, displayMoney } from '../lib/money';

	let storage;

		const headers = [
			{ key: 'code', value: 'Código' }, 
			{ key: 'description', value: 'Descripción' },
			{ key: 'manufacture', value: 'Manufactura' },
			{ key: 'supplier', value: 'Proveedor' },
			{ key: 'price_cost', value: 'Precio Compra', sort: compareMoney },
			{ key: 'price_sell', value: 'Precio Venta', sort: compareMoney },
			{ key: 'amount', value: 'Stock' },
			{ key: 'min_stock', value: 'Stock minimo' },
			{ key: 'mid_stock', value: 'Stock medio' },
			{ key: 'max_stock', value: 'Stock máximo' },
        	{ key: 'status', value: 'Estado' }
    ]
	
    let items;
	onMount(async ()=>{
		 items = await apiFetch('/api/public/all_items');
	})

	function status(min, mid, max, stock){
		let percent="xd";
		if ( stock <= 0 ){
			percent = "black"
		}else if ( 0 < stock && stock <= min ){
			percent = "red"
		}else if ( min < stock && stock <= mid){
			percent = "yellow"
		}else if ( mid < stock && stock <= max ){
			percent = "green"
		}else if ( stock > max ){
			percent = "blue"
		}
		return percent
	}

	let rows= [];
	let spendable_itemsToList = [];
	let no_spendable_itemsToList = [];
	$: if (items && storage) {
		const spendable_items=items.spendable_stocks;
		const items_filtered = spendable_items.filter(({id_storage}) => id_storage === storage.value);
		spendable_itemsToList = items_filtered.map(( spendable_item ) => {
			return ({id: spendable_item.id_spendable_stock,
					code: spendable_item.spendable_products_code,
					description: spendable_item.description,
					manufacture: spendable_item.manufacture,
					supplier: spendable_item.supplier,
					amount: `${Number(spendable_item.spendable_stocks_amount).toFixed(2)} ${spendable_item.unit}`,
                    price_sell: spendable_item.price,
                    price_cost: spendable_item.cost,
                    min_stock: `${Number(spendable_item.min_stock).toFixed(2)} ${spendable_item.unit}`,
                    mid_stock: `${Number(spendable_item.mid_stock).toFixed(2)} ${spendable_item.unit}`,
                    max_stock: `${Number(spendable_item.max_stock).toFixed(2)} ${spendable_item.unit}`,
                    status: `${status(Number(spendable_item.min_stock), Number(spendable_item.mid_stock), Number(spendable_item.max_stock), Number(spendable_item.spendable_stocks_amount))}`
					})
		})
	}

	$: if (items && storage) {
		const no_spendable_items=items.no_spendable_stocks;
		const items_filtered = no_spendable_items.filter(({id_storage}) => id_storage === storage.value);
		no_spendable_itemsToList = items_filtered.map(( no_spendable_item ) => {
			return ({id: -no_spendable_item.id_no_spendable_stock,
					code: no_spendable_item.no_spendable_products_code,
					description: no_spendable_item.description,
					manufacture: no_spendable_item.manufacture,
					supplier: no_spendable_item.supplier,
					amount: `${Number(no_spendable_item.no_spendable_stocks_amount).toFixed(2)} ${no_spendable_item.unit}`,
					price_sell: no_spendable_item.price,
					price_cost: no_spendable_item.cost,
                    min_stock: `${Number(no_spendable_item.min_stock).toFixed(2)} ${no_spendable_item.unit}`,
                    mid_stock: `${Number(no_spendable_item.mid_stock).toFixed(2)} ${no_spendable_item.unit}`,
                    max_stock: `${Number(no_spendable_item.max_stock).toFixed(2)} ${no_spendable_item.unit}`,
					status: `${status(Number(no_spendable_item.min_stock), Number(no_spendable_item.mid_stock), Number(no_spendable_item.max_stock), Number(no_spendable_item.no_spendable_stocks_amount))}`
				})
		})
	}
	$: if (items) {
		rows = spendable_itemsToList.concat(no_spendable_itemsToList)
	}
</script>

<style>
	div{
		width: 100%;;
		overflow: auto;
	}

	.red{
		width: 3em;
		height: 1.5em;
		background-color: rgb(255, 0, 0);
	}

	.black{
		width: 3em;
		height: 1.5em;
		background-color: rgb(0, 0, 0);
	}

	.blue{
		width: 3em;
		height: 1.5em;
		background-color: rgb(0, 0, 255);
	}

	.yellow{
		width: 3em;
		height: 1.5em;
		background-color: rgb(255, 255, 0);
	}

	.green{
		width: 3em;
		height: 1.5em;
		background-color: rgb(0, 255, 0);
	}

	:global(html[theme="g100"]) .black,
	:global(html[theme="g100"]) .blue{
		outline: 1px solid var(--cds-ui-04);
	}
</style>

	<Storages bind:storage={storage} />

	{#if rows.length!=0}
		<h5>
			⬛ Negro: Stock agotado.
		</h5>

		<h5>
			🟥 Rojo: Stock por debajo del mínimo.
		</h5>

		<h5>
			🟨 Amarillo: Stock por debajo del medio.
		</h5>

		<h5>
			🟩 Verde: Stock por debajo del máximo.
		</h5>

		<h5>
			🟦 Azul: Stock por encima del máximo.
		</h5>

		<div>
			<DataTable 
				size="short" 
				title="Control de Inventario"
				sortable {headers} {rows}
				>
				<span slot="cell" let:cell>
					{#if cell.key === 'status' && cell.value === 'black'}
						<div class="black"/>
					{:else if cell.key === 'status' && cell.value === 'red'}
						<div class="red"/>
					{:else if cell.key === 'status' && cell.value === 'yellow'}
						<div class="yellow"/>
					{:else if cell.key === 'status' && cell.value === 'green'}
						<div class="green"/>
					{:else if cell.key === 'status' && cell.value === 'blue'}
						<div class="blue"/>
					{:else if cell.key === 'price_cost' || cell.key === 'price_sell'}
						$ {displayMoney(cell.value, 'USD')}
					{:else}
						{cell.value}
					{/if}
				</span>
			</DataTable>
		</div>

	{/if}
