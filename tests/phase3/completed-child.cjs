const {createRequire}=require('node:module');const load=createRequire('/app/package.json');load('reflect-metadata');
const {Infrastructure}=load('/app/dist/common/infrastructure'),{AiProcessor}=load('/app/dist/ai-gateway/runtime');
const infra=new Infrastructure(),processor=new AiProcessor(infra),execute=processor.gateway.execute.bind(processor.gateway);
processor.gateway.execute=async(...args)=>{const result=await execute(...args);process.send('provider-complete');await new Promise(resolve=>process.once('message',resolve));return result;};
processor.process({companyId:process.env.AUDIT_COMPANY_ID,operationId:process.env.AUDIT_OPERATION_ID}).then(()=>infra.onModuleDestroy()).catch(()=>process.exit(1));
