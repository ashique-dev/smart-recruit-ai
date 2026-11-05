import {readFileSync} from 'node:fs';
import {reconcile,approvedInventory} from './evidence.mjs';
// Offline only. The second file contains independently obtained, normalized generation rows.
try {
  const [applicationPath,generationPath,inventoryPath,provenance]=process.argv.slice(2);
  if(process.argv.length!==6)throw new Error();
  const application=JSON.parse(readFileSync(applicationPath,'utf8'));
  const independent=JSON.parse(readFileSync(generationPath,'utf8'));
  const binding=JSON.parse(readFileSync(inventoryPath,'utf8'));
  const expected=approvedInventory(binding.signed,binding.trust,binding.publicKey,binding.built,binding.requests,binding.receipts);
  const report=reconcile(application,independent,provenance,expected);
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='PASS')process.exitCode=2;
} catch {console.error('RECONCILIATION_INPUT_INVALID');process.exitCode=1;}
