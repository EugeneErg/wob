import '../src/entities/index.js'
import { World } from '../src/core/world.js'
const wall=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
const terr=(id,a,b,c,d)=>({id,type:'terrain',data:{points:wall(a,b,c,d),smoothness:.35,fill:'#2a3326',edge:'#66804f'}})
const L=(id,pts,sub)=>({id,type:'liquid',data:{points:pts,polys:null,substance:sub,grain:11,limit:1200}})
for(const run of [1,2,3]){
  const w=new World({width:1200,height:800,gravity:{x:0,y:1800},entities:[
   terr('floor',0,700,1200,800),terr('l',300,400,340,700),terr('r',860,400,900,700),
   // масло НАЛИТО ПОД воду — должно всплыть
   L('oil',[[350,620],[850,620],[850,690],[350,690]],'oil'),
   L('wat',[[350,500],[850,500],[850,612],[350,612]],'water')]})
  w.step(1/60)
  const mean=owner=>{const p=w.physics.points.filter(q=>q.owner===owner&&!q.removed)
    return p.reduce((s,q)=>s+q.y,0)/p.length}
  const marks=[]
  for(let sec=1;sec<=20;sec++){ for(let i=0;i<60;i++) w.step(1/60)
    if(sec%5===0) marks.push(`${sec}с ${mean('oil').toFixed(0)}/${mean('wat').toFixed(0)}`) }
  console.log(`прогон ${run}: масло/вода →`, marks.join('  '), '| всплыло:', mean('oil')<mean('wat'))
}
