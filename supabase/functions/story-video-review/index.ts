import {createClient} from 'jsr:@supabase/supabase-js@2';
import {createStoryReviewHandler} from './handler.mjs';
const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
Deno.serve(createStoryReviewHandler({callerClient:(auth:string)=>createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}}),serviceClient:service,apiKey:Deno.env.get('OPENAI_API_KEY'),model:Deno.env.get('OPENAI_VIDEO_MODEL')||'gpt-4.1-mini',zeroRetentionConfirmed:Deno.env.get('OPENAI_VIDEO_ZDR_CONFIRMED')==='true'}));
