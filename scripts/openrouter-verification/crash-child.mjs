import {createRequire} from 'node:module';
import {boundedTransport} from './limit.mjs';
import {syntheticResponse,designatedSettings} from './fixture.mjs';
const load=createRequire('/app/package.json');load('reflect-metadata');
const {Infrastructure}=load('/app/dist/common/infrastructure');
const {AiProcessor}=load('/app/dist/ai-gateway/runtime');
const {AiGateway,aiSettings,AiFailure}=load('/app/dist/ai-gateway/gateway');
const infra=new Infrastructure(),processor=new AiProcessor(infra);
processor.gateway=new AiGateway(designatedSettings(aiSettings),boundedTransport(process.env.VERIFICATION_COUNTER,async(_url,options)=>Response.json(syntheticResponse(options)),()=>new AiFailure('VERIFICATION_SEND_DENIED')));
const execute=processor.gateway.execute.bind(processor.gateway);
processor.gateway.execute=async(...args)=>{const result=await execute(...args);process.send('provider-response-received');await new Promise(()=>{});return result;};
try {await processor.process({companyId:process.env.VERIFICATION_COMPANY,operationId:process.env.VERIFICATION_OPERATION});}
catch {process.exitCode=1;}
finally {await infra.onModuleDestroy();}
