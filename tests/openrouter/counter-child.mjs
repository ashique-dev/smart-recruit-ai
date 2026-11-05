import {consume} from '../../scripts/openrouter-verification/limit.mjs';
try {consume(process.argv[2],process.argv[3],process.argv[4]);process.exitCode=0;}
catch {process.exitCode=2;}
