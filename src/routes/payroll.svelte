<script>
    import { apiFetch } from '../functions';
    import PayrollAccount from '../components/Payroll_account.svelte';
    import { Button, Tile } from 'carbon-components-svelte';
    import { displayMoney } from '../lib/money';
    let payroll_accounts=[],preview=[],saving=false,generation=0;
    $: valid=payroll_accounts.length>0 && payroll_accounts.every(p=>p.account && p.hours_by_odt && p.hours_by_odt.length>0);
    function selection() {
        return payroll_accounts.flatMap(({hours_by_odt,account})=>hours_by_odt.map(h=>({id_payroll_odt_hour:h.id_payroll_odt_hour,id_account:account.id_account})));
    }
    function displayHours(value) {
        if (value == null) return 'Pendiente';
        const [whole, fraction = ''] = String(value).split('.');
        const decimals = fraction.replace(/0+$/, '');
        return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (decimals ? '.' + decimals : '');
    }
    async function get_preview() {
        const accounts = payroll_accounts.map(({ account }) => account);
        preview=[];saving=true;
        try {
            const result = await apiFetch('/api/public/payroll_preview', {
                method: 'POST', body: JSON.stringify({ payrolls: selection() }),
                headers: { 'Content-Type': 'application/json' }
            });
            preview = result.payroll.map(row => {
                const account = accounts.find(account => account?.id_account === row.v_id_account);
                return { ...row, currency: account?.code?.toUpperCase() || account?.symbol };
            });
        }
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
    <Tile>Usuario {row.v_id_user} · Cuenta {row.v_id_account}: {displayMoney(row.v_amount, row.currency)} {row.currency || ''} · {displayHours(row.v_total_hours)} horas</Tile>
{/each}
<Button disabled={!valid || saving} on:click={send_payroll}>Pagar nómina</Button>
