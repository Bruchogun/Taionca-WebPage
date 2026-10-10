
<script>
    import { TextInput, Button } from 'carbon-components-svelte';
    import Users from "../components/Users.svelte";
	import TrashCan16 from "carbon-icons-svelte/lib/TrashCan16";
    import PercentInput from './PercentInput.svelte';

    const NEW_USER = {
        user: {},
        id_user: null,
        profit_percent: .05
    };

    export let users_profit = [ {...NEW_USER} ];
    export let label;

    function addUserProfit() {
        users_profit = [ ...users_profit, {...NEW_USER} ]
    }

    function removeUserProfitBuilder(index_to_remove) {
        return ()=>{
            users_profit = users_profit.filter((_u, index) => index !== index_to_remove)
        }
    }

    function selectUser(index, user) {
        users_profit = users_profit.map((entry, i) => i === index
            ? { ...entry, user, id_user: user && user.value }
            : entry);
    }

</script>

<style>
    div {
        margin-bottom: 1em;
    }
    .OnSameLine{
        display: flex;
        justify-content: flex-start;
    }
</style>

<div>
    <h4>{label}</h4>
    {#each users_profit as user_profit, index}
        <div class="OnSameLine">
            <Users bind:user={user_profit.user} on:select={event => selectUser(index, event.detail)} />
        
            <PercentInput bind:value={user_profit.profit_percent}/>
        
            <Button kind="danger" hasIconOnly iconDescription="Borrar" icon={TrashCan16} type="button" on:click={removeUserProfitBuilder(index)}/>
        </div>
    {/each}
    
    <Button type="button" on:click={addUserProfit}>Agregar usuario</Button>
</div>
