<script>
    import { Button, NumberInput } from "carbon-components-svelte";
	import { apiFetch } from '../functions';
	import { onMount } from 'svelte';
	import PayrollUsers from '../components/Payroll_users.svelte';
	import Odts from '../components/Odts.svelte';
import Users from '../components/Users.svelte';

	let awaiting_approval_responsibilitys = [];
	async function get_responsibilitys(){
		({awaiting_approval_responsibilitys} = await apiFetch('/api/public/not_approving_pending_responsibilitys'));
	}
	onMount(async ()=>{
	})

	let payroll_user;
	let odt;
	let hours;
	let invalid = false;
	let invalidText;
	async function send_responsibility(){
		
		await apiFetch("/api/public/new_payroll_hours",{
			method: 'POST',
			body: JSON.stringify({
				id_user: payroll_user.id_user,
				hours_available: payroll_user.hours,
				hours_spent: hours,
				id_odt: odt.id_odt
			}),
			headers: {'Content-Type': 'application/json'}
		})
		cleanWindows()
	}

	function cleanWindows(){
		payroll_user = null;
		odt = null;
		hours = null;
		invalid = null;
		invalidText = null;
	}

	// $:if(payroll_user){
	// 	console.log(payroll_user.id_user);
	// 	console.log(payroll_user.hours);
	// 	console.log(hours);
	// 	console.log(odt.id_odt);
	// }
	
	$: if(payroll_user && hours > payroll_user.hours){
		invalid=true;
		invalidText = "Demasidas horas";
	}else if (payroll_user && hours <= 0){
		invalid=true;
		invalidText = "Horas inválidas";
	}else {
		invalid=false;
	}
    
</script>
        
<PayrollUsers bind:payroll_user={payroll_user}/>

<Odts bind:odt={odt}/>

<NumberInput bind:value={hours} step="0.5" invalid={invalid} invalidText={invalidText}/>

<Button on:click={send_responsibility}>Enviar</Button>