export const description = 'Build reliable TypeScript APIs.';
export const requirement = {key:'apis',text:'Build reliable TypeScript APIs',quote:description,start:0,end:description.length};
export function syntheticResponse(options) {
  const request = JSON.parse(options.body), {correlationId} = JSON.parse(request.messages[1].content);
  const analysis = request.response_format.json_schema.name === 'job_analysis';
  const output = analysis ? {task:'job-analysis',schemaVersion:'job-analysis.output.v1',correlationId,requirements:[requirement],ambiguities:[],missingInformation:[]} :
    {task:'rubric-draft',schemaVersion:'rubric-draft.output.v1',correlationId,criteria:[{key:'api_delivery',label:'API delivery',description:'Build reliable APIs',weight:10000,anchors:['None','Limited','Partial','Meets','Exceeds'],evidenceRequirements:'Cite API implementation evidence',requirementKeys:['apis']}]};
  return {id:`gen-${correlationId}`,provider:'Synthetic',model:'verification/synthetic',
    usage:{prompt_tokens:100,completion_tokens:50,prompt_tokens_details:{cached_tokens:0,cache_write_tokens:5},cost:0.001},
    choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]};
}
export function designatedSettings(aiSettings) {
  if (process.env.VERIFICATION_MODE !== 'synthetic' || process.env.AI_PROVIDER !== 'openrouter' || process.env.OPENROUTER_API_KEY !== 'synthetic-not-a-credential') throw new Error('VERIFICATION_MODE_DENIED');
  return aiSettings();
}

export const responseAttackModes=['literal','unicode','nested-json','split-escapes','array','object','structured-text','error-content','malformed-outer','malformed-nested','unexpected-envelope','oversized'];
export function responseFixture(mode,options,key) {
 const body=syntheticResponse(options),nested=JSON.parse(body.choices[0].message.content);
 const escaped=[...key].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
 if(mode==='malformed-outer')return '{';
 if(mode==='error-content')return JSON.stringify({error:{message:key}});
 if(mode==='oversized')return ' '.repeat(150001);
 if(mode==='unexpected-envelope')body.unexpected=true;
 if(['literal','unicode','nested-json','split-escapes','structured-text'].includes(mode))nested.ambiguities=[key];
 if(mode==='array')nested.ambiguities=[[key]];
 if(mode==='object')nested.ambiguities=[{nested:key}];
 let content=JSON.stringify(nested);
 if(mode==='nested-json'||mode==='split-escapes')content=content.replace(key,mode==='nested-json'?escaped:[...key].map((c,i)=>i%2?'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'):c).join(''));
 body.choices[0].message.content=mode==='malformed-nested'?'{':content;
 const text=JSON.stringify(body);return mode==='unicode'?text.replace(key,escaped):text;
}
