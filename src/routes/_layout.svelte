<script context="module">
    export async function preload(page,session) {
        if(page.path==='/login'||page.path==='/about'||page.path.startsWith('/blog')) return {authUser:session.user||null};
        const response=await this.fetch('/api/auth/access?path='+encodeURIComponent(page.path));
        if(response.status===401) return this.redirect(302,'/login');
        if(response.status===403) return this.redirect(302,'/sin_acceso');
        if(!response.ok) return this.error(response.status,'No se pudo verificar el acceso.');
        return {authUser:(await response.json()).session};
    }
</script>
<script>
    import Logout32 from 'carbon-icons-svelte/lib/Logout32';
    import { goto,stores } from '@sapper/app';
    import { onMount } from 'svelte';
    import { session,notifications } from '../stores';
    import { canPage,pageAccess } from '../security/access';
    import { Header,HeaderUtilities,HeaderAction,HeaderGlobalAction,HeaderPanelLinks,HeaderPanelDivider,HeaderPanelLink,SideNav,SideNavItems,SideNavMenu,SideNavMenuItem,SideNavLink,SkipToContent,Content,InlineNotification,ToastNotification } from 'carbon-components-svelte';
    import Loader from '../components/Loader.svelte';
    export let authUser=null;
    const {page:currentPage}=stores();
    let allowedPath=null,accessVersion=0,accessError='';
    // Sapper reuses layouts during client navigation. Recheck before mounting the next page.
    $: if(process.browser) verifyPage($currentPage.path);
    async function verifyPage(path){
        const version=++accessVersion;allowedPath=null;accessError='';
        if(pageAccess(path)==='public'){if(path==='/login')authUser=null;allowedPath=path;return;}
        try{
            const response=await fetch('/api/auth/access?path='+encodeURIComponent(path));
            if(version!==accessVersion)return;
            if(response.status===401){authUser=null;await goto('/login');return;}
            if(response.status===403){await goto('/sin_acceso');return;}
            if(!response.ok){accessError='No se pudo verificar el acceso. Inténtalo nuevamente.';return;}
            const result=await response.json();if(version!==accessVersion)return;
            authUser=result.session;allowedPath=path;
        }catch(error){if(version===accessVersion)accessError='No se pudo verificar el acceso. Inténtalo nuevamente.';}
    }
    $: $session=authUser;
    let isSideNavOpen=false,isOpen=false;
    onMount(()=>{isSideNavOpen=window.innerWidth>=1056;});
    const groups=[
        ['Gestión de usuarios',[
            ['/signup','Crear usuario'],['/ingreso_clients','Crear cliente'],['/asignar_responsabilities','Asignar responsabilidad'],['/ingreso_responsabilities','Crear responsabilidad'],['/approve_responsabilities','Aprobar responsabilidad'],['/responsabilities','Responsabilidades'],['/attendance','Asistencia'],['/asign_hours_odt','Horas por ODT'],['/loans','Gestión de deudas'],['/give_loans','Dar préstamos'],['/pay_loans','Pagar préstamos']]],
        ['Gestión de ODTs',[
            ['/limit_resources','Limitación de recursos'],['/odt_quotation','Nueva cotización'],['/nueva_odt','Nueva ODT'],['/abonos_odt','Abonos de ODT'],['/cerrar_odt','Cerrar ODT'],['/odts_review','Registro ODTs'],['/quotations_review','Registro cotizaciones']]],
        ['Gestión de gastos',[
            ['/gastos_generales','Gastos generales'],['/gasto_admin','Gastos administrativos'],['/gasto_inventario','Gastos de inventario']]],
        ['Gestión monetaria',[
            ['/investments','Inversiones'],['/money_incomes','Ingreso de dinero'],['/cambio_moneda','Cambios de moneda'],['/money_transfer','Transferencias'],['/balances','Balance'],['/balance_registers','Registros de balances'],['/create_account','Crear cuenta bancaria'],['/movements_review','Cierre'],['/payroll','Nómina']]],
        ['Gestión de inventario',[
            ['/inventory_review','Registro de inventario'],['/control_inv','Control de inventario'],['/reposicion_inv','Reposición de inventario'],['/ingreso_spendable_inv','Ingreso de inventario consumible'],['/ingreso_no_spendable_inv','Ingreso de inventario no consumible'],['/ingreso_storages','Registrar almacenes'],['/ingreso_suppliers','Registrar proveedores']]]
    ];
    $: visibleGroups=groups.map(([label,links])=>[label,links.filter(([path])=>canPage($session,path))]).filter(([,links])=>links.length);
    async function logout(){
        const response=await fetch('/api/user',{method:'DELETE'});
        if(response.ok){authUser=null;$session=null;await goto('/login');}
    }
</script>
<style>.notifications{position:fixed;display:flex;flex-direction:column-reverse;bottom:0;right:0;z-index:9999}</style>
<Header href={canPage($session,'/')?'/':'/attendance'} company="Taionca" platformName="Página Web" bind:isSideNavOpen>
    <div slot="skip-to-content"><SkipToContent/></div>
    <HeaderUtilities>
        {#if $session}
            <HeaderAction bind:isOpen><HeaderPanelLinks><HeaderPanelDivider>Preferencias de usuario</HeaderPanelDivider><HeaderPanelLink href="/change_password">Cambiar contraseña</HeaderPanelLink></HeaderPanelLinks></HeaderAction>
            <HeaderGlobalAction on:click={logout} aria-label="Cerrar sesión" iconDescription="Cerrar sesión" icon={Logout32}/>
        {/if}
    </HeaderUtilities>
</Header>
<SideNav ariaLabel="Navegación principal" bind:isOpen={isSideNavOpen}><SideNavItems>
    {#if !$session}<SideNavLink href="/login" text="Inicio de sesión"/>
    {:else}
        {#if $session.is_admin}<SideNavLink href="/administracion_permisos" text="Administrar permisos"/>{/if}
        {#each visibleGroups as [label,links]}<SideNavMenu text={label} aria-label={label}>{#each links as [path,text]}<SideNavMenuItem href={path} {text}/>{/each}</SideNavMenu>{/each}
    {/if}
</SideNavItems></SideNav>
<Content>{#if pageAccess($currentPage.path)==='public' || (process.browser && allowedPath===$currentPage.path)}<slot/>{:else if accessError}<p role="alert">{accessError}</p><button on:click={()=>verifyPage($currentPage.path)}>Reintentar acceso</button>{:else}<p role="status">Verificando acceso…</p>{/if}</Content>
<div class="notifications">{#each $notifications as notification,index (index)}{#if notification}{#if notification.caption}<ToastNotification {...notification}/>{:else}<InlineNotification {...notification}/>{/if}{/if}{/each}</div>
<Loader/>
