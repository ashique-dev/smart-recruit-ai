const {createRequire}=require('node:module');const load=createRequire('/app/package.json');load('reflect-metadata');
const {Infrastructure}=load('/app/dist/common/infrastructure');const {AiProcessor,AiRuntime}=load('/app/dist/ai-gateway/runtime');
const infra=new Infrastructure(),processor=new AiProcessor(infra);processor.gateway.execute=()=>new Promise(()=>{});const runtime=new AiRuntime(infra,processor);runtime.onModuleInit();
