<script context="module">
    // The old automatic payroll endpoint no longer matches the payroll data model.
    export function preload() {
        return this.redirect(302, '/payroll');
    }
</script>
