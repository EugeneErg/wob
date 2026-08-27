import '../src/entities/index.js'
import { World } from '../src/core/world.js'
const wall=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
const terr=(id,a,b,c,d)=>({id,type:'terrain',data:{points:wall(a,b,c,d),smoothness:.35,fill:'#2a3326',edge:'#66804f'}})
const L=(id,x0,x1)=>({id,type:'liquid',data:{points:[[x0,500],[x1,500],[x1,690],[x0,690]],polys:null,substance:'water',grain:11,limit:600}})
const w=new World({width:1200,height:800,gravity:{x:0,y:1800},entities:[
 terr('floor',0,700,1200,800),terr('l',300,400,340,700),terr('r',860,400,900,700),
 L('a',350,590), L('b',610,850)]})
w.step(1/60)
for(let i=0;i<300;i++) w.step(1/60)
// физически слились?
const fd=w.physics.fluid
const ga=w.physics.points.find(p=>p.owner==='a')._i, gb=w.physics.points.find(p=>p.owner==='b')._i
const s=w.physics.store
let cross=0
for(let a=0;a<fd.count;a++){
  const i=fd.idx[a], gi=s.group[i]
  for(let u=0;u<fd.nc[a];u++){ const b=fd.nbr[a*40+u]; if(s.group[fd.idx[b]]!==gi){cross++;break} }
}
console.log(`сред: ${w.physics.mediums.length}, частиц ${fd.count}, у ${cross} есть сосед из другой лужи ⇒ физически слились: ${cross>20}`)
const paths=w.scene().filter(x=>x.k==='path'&&x.d)
console.log(`контуров нарисовано: ${paths.length} ⇒ ${paths.length>1?'ШОВ: две лужи рисуются раздельно':'единая поверхность'}`)
