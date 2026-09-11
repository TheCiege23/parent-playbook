const fs=require('node:fs'),path=require('node:path');
const progress=JSON.parse(fs.readFileSync(path.join(__dirname,'parity-progress.json'),'utf8'));
if(progress.categories.reduce((n,c)=>n+c.weight,0)!==100)throw Error('Parity weights must total 100');
if(progress.categories.some(c=>![0,.25,.5,.75,1].includes(c.stage)||!Number.isFinite(c.weight)||c.weight<=0))throw Error('Invalid parity stage or weight');
const points=progress.categories.reduce((n,c)=>n+c.weight*c.stage,0);
console.log(JSON.stringify({scope:progress.scope,estimated_total_percent:Math.round(points),weighted_points:points,fully_accepted_categories:progress.categories.filter(c=>c.stage===1).length,total_categories:progress.categories.length,method:progress.method},null,2));
