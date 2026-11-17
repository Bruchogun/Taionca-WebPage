<script>
	import { onMount } from 'svelte';
	import { session } from '../stores';
	import { allows } from '../security/access';
	import 'carbon-components-svelte/css/white.css';
	import {DataTable} from "carbon-components-svelte";
	import { apiFetch } from '../functions';
    import { displayMoney, units } from '../lib/money';
    import SelectSearch from '../components/Select.svelte';
	
	let user;
	let rows;
	let rows_register;
	let loans;
	let loans_register;
    let usersToList=[];
    let company_rows;
    let company_rows_register;
    let purchase_rows=[];

	async function get_loans(){
		if(!user){rows=[];rows_register=[];company_rows=[];company_rows_register=[];purchase_rows=[];return;}
		({loans_register} = await apiFetch('/api/public/loans_registers'));
        const response=await apiFetch('/api/public/loans');
        const purchases=await apiFetch('/api/public/unassigned_company_purchases');
        loans=response.loans;
		let loans_filtered = loans.filter(({id_user}) => id_user === user.value);
		rows = loans_filtered.map(loan => ({
			id: loan.id_loan,
			currency: loan.name_plural.replace(/(^|\s)\S/g, l => l.toUpperCase()),
			amount: `${Number(loan.amount).toFixed(2)} ${loan.symbol}`
		}));


		let loans_register_filtered = loans_register.filter(({id_user}) => id_user === user.value); 
		rows_register = loans_register_filtered.map(loan_register => ({
			id: loan_register.id_loans_register,
			currency: loan_register.name_plural.replace(/(^|\s)\S/g, l => l.toUpperCase()),
			amount: `${Number(loan_register.amount).toFixed(2)} ${loan_register.symbol}`,
			description: loan_register.description,
			date: new Date(loan_register.created_at).toLocaleDateString()
		}));
        company_rows=(response.company_debts||[]).filter(debt=>debt.id_owner_user===user.value).map(debt=>({
            id:debt.id_company_debt,
            account:debt.account_name,
            currency:debt.name_plural.replace(/(^|\s)\S/g,l=>l.toUpperCase()),
            amount:`${displayMoney(debt.amount)} ${debt.symbol}`
        }));
        company_rows_register=(response.company_debt_registers||[]).filter(debt=>debt.id_owner_user===user.value).map(debt=>({
            id:debt.id_company_debt_movement,
            original_date:debt.occurred_at?new Date(debt.occurred_at).toLocaleDateString('es-CO'):'Pendiente',
            recorded_date:new Date(debt.created_at).toLocaleDateString('es-CO'),
            account:debt.account_name,
            currency:debt.name_plural.replace(/(^|\s)\S/g,l=>l.toUpperCase()),
            kind:debt.kind==='advance'?'Adelanto':'Devolución',
            amount:`${displayMoney(debt.amount)} ${debt.symbol}`,
            description:debt.description
        }));
        purchase_rows=(purchases.unassigned_company_purchases||[])
            .filter(purchase=>purchase.owner_user_id===user.value)
            .map(purchase=>({
                id:purchase.id_purchase,
                owner:[purchase.owner_name,purchase.owner_lastname].filter(Boolean).join(' ').trim(),
                currency:purchase.currency_code,
                amount:purchase.amount,
                description:purchase.description,
                source:`${purchase.sheet_title||purchase.account_name}!${purchase.source_cell}`,
                merchant_payment:'Pagado por propietario',
                status:'Pendiente'
            }));
	}

	$: canReadAll = allows($session,['finance.read','finance.loans']);
	onMount(async()=>{
        if(canReadAll){
            const response=await apiFetch('/api/public/loans');
            usersToList=(response.loan_users||[]).map(({user_id,name,lastname})=>({
                value:user_id,label:[name,lastname].filter(Boolean).join(' ').trim()
            }));
        }else{user={value:$session.user_id};await get_loans();}
    });

    //HEADERS
	let headers = [
	{ key: "currency", value: "Moneda"  },
    { key: "amount", value: "Saldo adeudado" }
	];
    const company_headers=[
        {key:'account',value:'Cuenta'},
        {key:'currency',value:'Moneda'},
        {key:'amount',value:'Saldo adeudado'}
    ];
    const company_register_headers=[
        {key:'original_date',value:'Fecha original'},
        {key:'recorded_date',value:'Registrado'},
        {key:'account',value:'Cuenta'},
        {key:'currency',value:'Moneda'},
        {key:'kind',value:'Tipo'},
        {key:'amount',value:'Importe'},
        {key:'description',value:'Comentario'}
    ];
    const purchase_headers=[
        {key:'owner',value:'Propietario'},
        {key:'currency',value:'Moneda',sort:false},
        {key:'amount',value:'Importe',display:displayMoney,sort:(a,b)=>units(a)<units(b)?-1:units(a)>units(b)?1:0},
        {key:'description',value:'Concepto'},
        {key:'source',value:'Celda de origen'},
        {key:'merchant_payment',value:'Pago al comercio',sort:false},
        {key:'status',value:'ODT',sort:false}
    ];

	let headers_register = [
	{ key: "date", value: "Registrado" },
	{ key: "currency", value: "Moneda"  },
    { key: "amount", value: "Saldo" },
    { key: "description", value: "Comentario" },
	];

</script>

<h5>Gestión de deudas</h5>

{#if canReadAll}<SelectSearch on:select={get_loans} bind:selected={user} items={usersToList} isClearable={false} selectedValue="Usuarios..."/>{:else}<p>Mis deudas</p>{/if}

{#if rows}<DataTable size="short" title="El usuario debe a Taionca" sortable {headers} {rows} />{/if}

{#if rows_register}<div class="loan-history"><DataTable size="short" title="Registro de préstamos" sortable headers = {headers_register} rows = {rows_register} /></div>{/if}

{#if company_rows}<DataTable size="short" title="Taionca debe al usuario" sortable headers={company_headers} rows={company_rows} />{/if}

{#if company_rows_register}
    <div class="company-history">
        <DataTable size="short" title="Registro de adelantos a Taionca" sortable headers={company_register_headers} rows={company_rows_register} />
    </div>
{/if}

{#if purchase_rows.length}
    <div class="bx--data-table-header">
        <h4 class="bx--data-table-header__title">Compras de Taionca pendientes de ODT ({purchase_rows.length})</h4>
    </div>
    <div class="purchase-history">
        <DataTable size="short" sortable headers={purchase_headers} rows={purchase_rows} />
    </div>
{/if}

<style>
    .company-history,.loan-history,.purchase-history {width:100%;overflow-x:auto;}
    .purchase-history :global(.bx--data-table){min-width:60rem;table-layout:fixed;}
    .purchase-history :global(.bx--data-table th),.purchase-history :global(.bx--data-table td){white-space:normal;overflow-wrap:anywhere;}
    .purchase-history :global(.bx--data-table th:nth-child(1)){width:16%;}
    .purchase-history :global(.bx--data-table th:nth-child(2)){width:9%;}
    .purchase-history :global(.bx--data-table th:nth-child(3)){width:11%;}
    .purchase-history :global(.bx--data-table th:nth-child(4)){width:22%;}
    .purchase-history :global(.bx--data-table th:nth-child(5)){width:17%;}
    .purchase-history :global(.bx--data-table th:nth-child(6)){width:13%;}
    .purchase-history :global(.bx--data-table th:nth-child(7)){width:12%;}
    .purchase-history :global(.bx--data-table td:nth-child(3)){white-space:nowrap;}
    @media(max-width:40rem){
        .loan-history :global(.bx--data-table){min-width:32rem}
        .company-history :global(.bx--data-table){min-width:56rem}
    }
</style>
