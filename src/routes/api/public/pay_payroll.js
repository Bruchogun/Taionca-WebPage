// Payroll now requires selecting hours and destination accounts in /payroll.
// Keep the legacy URL explicit and side-effect free instead of calling payroll() without arguments.
export function get(req, res) {
    res.statusCode = 410;
    res.json({
        warning: 'Selecciona las horas y cuentas en el módulo de nómina para realizar el pago.',
        redirect: '/payroll'
    });
}
