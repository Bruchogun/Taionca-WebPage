<script>
    import 'carbon-components-svelte/css/white.css';
    import { apiFetch } from '../functions';
    import PayrollAccount from '../components/Payroll_account.svelte';
    import { Button, Tile } from 'carbon-components-svelte';
    import { displayMoney } from '../lib/money';
    let payroll_accounts=[],preview=[],saving=false,generation=0;
    $: valid=payroll_accounts.length>0 && payroll_accounts.every(p=>p.account && p.hours_by_odt && p.hours_by_odt.length>0);
    function selection() {
        return payroll_accounts.flatMap(({hours_by_odt,account})=>hours_by_odt.map(h=>({id_payroll_odt_hour:h.id_payroll_odt_hour,id_account:account.id_account})));
    }
    async function get_preview() {
        preview=[];saving=true;
        try { const result=await apiFetch('/api/public/payroll_preview',{method:'POST',body:JSON.stringify({payrolls:selection()}),headers:{'Content-Type':'application/json'}});preview=result.payroll; }
        finally {saving=false;}
    }
    async function send_payroll() {
        saving=true;
        try {
            await apiFetch('/api/public/new_payroll_expense',{method:'POST',body:JSON.stringify({payrolls:selection()}),headers:{'Content-Type':'application/json'}});
            payroll_accounts=[];preview=[];generation++;
        } finally {saving=false;}
    }
</script>
{#key generation}<PayrollAccount label="Nómina" bind:payroll_accounts/>{/key}
<Button disabled={!valid || saving} on:click={get_preview}>Calcular nómina</Button>
{#each preview as row}
    <Tile>Usuario {row.v_id_user} · Cuenta {row.v_id_account}: {displayMoney(row.v_amount)} {payroll_accounts.find(p=>p.account && p.account.id_account===row.v_id_account)?.account.code.toUpperCase()} · {displayMoney(row.v_total_hours)} horas</Tile>
{/each}
<Button disabled={!valid || saving} on:click={send_payroll}>Pagar nómina</Button>
