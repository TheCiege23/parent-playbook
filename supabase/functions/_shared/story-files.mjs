// Flat athlete-prefixed files; called only after an authorized athlete/family deletion.
export async function purgeStoryFiles(service,athleteId){
  const bucket=service.storage.from('story-contributions');const paths=[];let offset=0;
  while(true){
    const {data,error}=await bucket.list(athleteId,{limit:100,offset});
    if(error)throw Error('Could not list story files');if(!data?.length)break;
    paths.push(...data.map(f=>athleteId+'/'+f.name));if(data.length<100)break;offset+=100;
  }
  for(let i=0;i<paths.length;i+=100){const result=await bucket.remove(paths.slice(i,i+100));if(result.error)throw Error('Could not remove story files');}
  return paths.length;
}
