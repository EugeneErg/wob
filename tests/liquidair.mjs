import '../src/entities/index.js'
import { World } from '../src/core/world.js'
const wall=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
const terr=(id,a,b,c,d)=>({id,type:'terrain',data:{points:wall(a,b,c,d),smoothness:.35,fill:'#2a3326',edge:'#66804f'}})
function run(withWater){
  const e=[terr('floor',0,700,1200,800),terr('l',300,400,340,700),terr('r',860,400,900,700)]
  if(withWater) e.push({id:'w',type:'liquid',data:{points:[[345,480],[855,480],[855,695],[345,695]],polys:null,substance:'water',grain:11,limit:2000}})
  e.push({id:'fan',type:'fan',data:{x:600,y:300,angle:90,power:900,nozzle:46,cell:22,push:16,show:false,color:'#7fb6cc'}})
  const w=new World({width:1200,height:800,gravity:{x:0,y:1800},entities:e})
  for(let i=0;i<240;i++) w.step(1/60)
  const f=w.sharedPeek('air').field
  const i=Math.floor(600/f.cell), j=Math.floor(660/f.cell)
  return Math.abs(f.v[i+j*f.nx])+Math.abs(f.u[i+j*(f.nx+1)])
}
const dry=run(false), wet=run(true)
console.log(`поток у дна таза: без воды ${dry.toFixed(1)} | с водой ${wet.toFixed(1)} ⇒ вода не пускает воздух: ${wet<dry*0.5}`)
