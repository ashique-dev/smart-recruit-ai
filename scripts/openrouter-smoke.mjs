// Retired after GA-02: this standalone path bypassed durable verification admission.
// It must not import the application gateway, read credentials or make network calls.
console.error('LEGACY_SMOKE_DISABLED: use the separately approved verification entry point.');
process.exitCode = 1;
