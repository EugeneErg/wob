import '../src/entities/index.js'
import { World } from '../src/core/world.js'
const wall=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
const terr=(id,a,b,c,d)=>({id,type:'terrain',data:{points:wall(a,b,c,d),smoothness:.35,fill:'#2a3326',edge:'#66804f'}})
// пол без боковых стен: всплеск улетит за край
const w=new World({width:1200,height:800,gravity:{x:0,y:1800},entities:[
 terr('floor',0,740,1200,800),
 {id:'w',type:'liquid',data:{points:[[560,100],[660,100],[660,320],[560,320]],polys:null,substance:'water',grain:11,limit:400}}]})
w.step(1/60)
const n0=w.physics.points.filter(p=>p.owner==='w').length
for(let i=0;i<60*12;i++) w.step(1/60)
const n1=w.physics.points.filter(p=>p.owner==='w'&&!p.removed).length
console.log(`было ${n0}, осталось ${n1} ⇒ улетевшие прибраны: ${n1<n0}`)
