<script>
    import InputGeneralExpenses from "../components/Input_general_expenses.svelte";
    import InputInvExpenses from "../components/Input_inv_expenses.svelte";
    import { Button, DataTable, TextArea } from "carbon-components-svelte";
    import Currency from "../components/Currency.svelte";
	import 'carbon-components-svelte/css/white.css';
    import { apiFetch } from '../functions';
    import Clients from "../components/Clients.svelte";

    let general_expenses;
    let inv_expenses;
    let currency;
    let quotation;
    let rows = [];
    let client;
    let description;
    
    async function create_quotation(){
        quotation = await apiFetch(`/api/public/create_quotation`,{
            method: 'POST',
            body: JSON.stringify({
                general_expenses,
                inv_expenses,
                currency,
                id_client: client.value,
                description
            }),headers: {'Content-Type': 'application/json'}
        });
    }


    //HEADERS
	const headers = [
	{ key: "category", value: "Categoría"  },
    { key: "amount", value: "Monto" }
	];

    $: if(quotation){

        //ROWS
        rows = [
        { id: 1, category: "Gastos generales", amount: `${(quotation.total_general_expenses).toFixed(2)} ${currency.symbol}`},
        { id: 2, category: "Gastos de inventario", amount: `${(quotation.total_inv_expenses).toFixed(2)} ${currency.symbol}`},
        { id: 3, category: "Gastos administrativos", amount: `${(quotation.contract_amount * quotation.admin_percent).toFixed(2)} ${currency.symbol}`},
        { id: 4, category: "Monto de contrato cotizado", amount: `${(quotation.contract_amount).toFixed(2)} ${currency.symbol}`}
        ];

    }


</script>


<h4>Selecciona el cliente objetivo para esta cotización</h4>

<Clients bind:client={client}/>

{#if client} 

    <InputGeneralExpenses label="Gastos generales" bind:general_expenses={general_expenses}/>

    <InputInvExpenses label="Gastos de inventario" bind:inv_expenses={inv_expenses}/>

    <h4>Moneda del monto de la cotización</h4>


    <Currency on:change={()=>quotation=null} bind:currency={currency}/>

    <TextArea labelText="Descripción" placeholder="Ingrese la descripción de la cotización..." bind:value={description}/>

    <Button on:click={create_quotation}>Cotizar</Button>

    {#if quotation}
        <DataTable
            size="short"
            description='Los datos de la cotización están en la moneda seleccionada para el monto de contrato'
            title="Cotización"
            {headers}
            {rows}
        />
    {/if}
{/if}