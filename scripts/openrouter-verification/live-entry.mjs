// Sole reserved live-verification entry point. This Gate A revision cannot activate it.
// No CLI flag, environment variable, run name or approval-file content enables live traffic.
// Activation requires a separately reviewed change after explicit owner approval.
console.error('LIVE_VERIFICATION_DISABLED_PENDING_EXPLICIT_APPROVAL');
process.exitCode = 1;
