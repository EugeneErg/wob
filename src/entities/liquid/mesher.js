// Скалярное поле → marching squares → SVG path.
//
// Перенесено из эталонной реализации. Три правила, из которых следует всё
// остальное:
//  · шаг сетки поля ДОЛЖЕН быть мельче расстояния между частицами, иначе слой
//    толщиной в одну частицу невозможно изобразить;
//  · радиус размазывания держим меньше самой тонкой стенки — тогда поле не
//    просачивается сквозь неё и маска твёрдых тел не нужна;
//  · тела рисуются ПОВЕРХ воды, поэтому контур можно спокойно заводить внутрь
//    стенки — берег получается плоским, а не скруглённым.
//
// Единственное отличие от эталона — призраки за стенками. Там «комната» была
// особым случаем: одно тело с четырьмя стенами, у которого в углу общий SDF
// даёт одну диагональную нормаль, и угол остаётся пустым. Здесь особого случая
// нет: любая фигура умеет перечислить свои стенки рядом с точкой (walls), а
// у кого их нет — отдаёт одну, свою ближайшую. Угловое отражение получается
// одинаково и у края уровня, и у полигона рельефа.

// Допуск прореживания в пикселях. Ниже трети пикселя разницы не видно, а
// вершин уходит больше половины.
const SIMPLIFY = 0.3;

// Рамер–Дуглас–Пойкер, без рекурсии: кольца бывают в тысячи точек, и
// рекурсивная версия на них упирается в глубину стека.
function simplify(pts, n, tol){
  if (n < 4) { const all=[]; for (let i=0;i<n;i++) all.push(i); return all; }
  const keep = new Uint8Array(n);
  keep[0]=1; keep[n-1]=1;
  const stack=[[0,n-1]];
  const t2=tol*tol;
  while (stack.length){
    const [a,b]=stack.pop();
    if (b<=a+1) continue;
    const ax=pts[a*2], ay=pts[a*2+1], bx=pts[b*2], by=pts[b*2+1];
    const dx=bx-ax, dy=by-ay, dd=dx*dx+dy*dy;
    let worst=-1, wd=t2;
    for (let i=a+1;i<b;i++){
      const px=pts[i*2], py=pts[i*2+1];
      let d;
      if (dd<1e-12){ const ex=px-ax, ey=py-ay; d=ex*ex+ey*ey; }
      else {
        let t=((px-ax)*dx+(py-ay)*dy)/dd;
        if (t<0) t=0; else if (t>1) t=1;
        const ex=px-(ax+t*dx), ey=py-(ay+t*dy);
        d=ex*ex+ey*ey;
      }
      if (d>wd){ wd=d; worst=i; }
    }
    if (worst>=0){ keep[worst]=1; stack.push([a,worst],[worst,b]); }
  }
  const out=[];
  for (let i=0;i<n;i++) if (keep[i]) out.push(i);
  return out;
}

export class SurfaceMesher {
  constructor(W, H, cs, scale){
    this.W = W; this.H = H;
    this.scale = scale;
    this.bufA = new Float32Array(1<<17);
    this.bufB = new Float32Array(1<<17);
    this.setResolution(cs);
  }
  setResolution(cs){
    this.cs = cs;
    this.nx = Math.ceil(this.W/cs)+3;
    this.ny = Math.ceil(this.H/cs)+3;
    this.ox = -cs; this.oy = -cs;
    const N = this.nx*this.ny;
    this.field = new Float32Array(N);
    this.next  = new Int32Array(N*2).fill(-1);   // самоочищается при обходе
    this.ptx   = new Float32Array(N*2);
    this.pty   = new Float32Array(N*2);
    this.starts = new Int32Array(N*2);
    this.cells = N;
    this.lastVerts = 0;
    this.prev = null;                            // прошлый грязный прямоугольник
  }
  clearRect(r){
    const f=this.field, nx=this.nx;
    for (let y=r[1]; y<=r[3]; y++){
      const row=y*nx;
      f.fill(0, row+r[0], row+r[2]+1);
    }
  }
  splat(sim, typeId, R){
    const f=this.field, nx=this.nx, ny=this.ny, cs=this.cs;
    const ox=this.ox, oy=this.oy, R2=R*R, invR2=1/R2;
    const x=sim.x, y=sim.y, tp=sim.type, n=sim.n;

    let minx=1e9, maxx=-1e9, miny=1e9, maxy=-1e9, used=0;
    for (let i=0;i<n;i++){
      if (typeId>=0 && tp[i]!==typeId) continue;
      used++;
      const xi=x[i], yi=y[i];
      if (xi<minx) minx=xi; if (xi>maxx) maxx=xi;
      if (yi<miny) miny=yi; if (yi>maxy) maxy=yi;
    }
    if (!used){ if (this.prev){ this.clearRect(this.prev); this.prev=null; } return 0; }

    const rad = Math.ceil(R/cs)+1;
    minx-=3*R; maxx+=3*R; miny-=3*R; maxy+=3*R;   // запас под зеркальные частицы и угловые
    let x0=Math.floor((minx-ox)/cs)-rad, x1=Math.ceil((maxx-ox)/cs)+rad;
    let y0=Math.floor((miny-oy)/cs)-rad, y1=Math.ceil((maxy-oy)/cs)+rad;
    if (x0<1) x0=1; if (y0<1) y0=1;
    if (x1>nx-2) x1=nx-2; if (y1>ny-2) y1=ny-2;
    const rect=[x0,y0,x1,y1];
    // чистим только объединение прошлой и новой области, а не всю сетку
    this.clearRect(rect);
    if (this.prev) this.clearRect(this.prev);
    this.prev = rect;
    this.rect = rect;

    // Зеркальные частицы за стенками. У приграничной частицы поле поддержано
    // только с одной стороны, изоповерхность не доходит до стенки — отсюда
    // скруглённый берег. Отражаем от КАЖДОЙ близкой стенки, а если их две
    // (угол) — добавляем ещё и двойное отражение, иначе угол остаётся пустым.
    // Зеркальные частицы за стенками. У приграничной частицы поле поддержано
    // только с одной стороны, изоповерхность не доходит до стенки — отсюда
    // скруглённый берег, заворачивающийся вниз.
    //
    // Стенку не ищем: контакт уже нашёл ближайшую поверхность для каждой точки
    // и записал расстояние с нормалью. Отражаем от неё.
    const bs=sim.bs, bnx=sim.bnx, bny=sim.bny, inSolid=sim.inSolid;
    const useGhosts = !!(bs && bnx && bny && inSolid);
    const splatAt=(cxw,cyw)=>{
      let a0=Math.floor((cxw-ox)/cs-rad), a1=Math.ceil((cxw-ox)/cs+rad);
      let b0=Math.floor((cyw-oy)/cs-rad), b1=Math.ceil((cyw-oy)/cs+rad);
      if (a0<x0) a0=x0; if (a1>x1) a1=x1;
      if (b0<y0) b0=y0; if (b1>y1) b1=y1;
      for (let yy=b0;yy<=b1;yy++){
        const wy=oy+yy*cs-cyw;
        if (R2-wy*wy<=0) continue;
        const row=yy*nx;
        for (let xx=a0;xx<=a1;xx++){
          const wx=ox+xx*cs-cxw;
          const d2=wx*wx+wy*wy;
          if (d2>=R2) continue;
          const q=1-d2*invR2;
          f[row+xx]+=q*q;
        }
      }
    };
    for (let i=0;i<n;i++){
      if (typeId>=0 && tp[i]!==typeId) continue;
      const xi=x[i], yi=y[i];
      splatAt(xi, yi);
      if (!useGhosts) continue;
      const sd=bs[i];
      if (!(sd<R)) continue;
      const s0 = sd>0 ? sd : 0;
      const nx=bnx[i], ny=bny[i];
      const gx=xi-2*s0*nx, gy=yi-2*s0*ny;
      // Зеркало имеет смысл, только если попало В ТВЁРДОЕ.
      if (!inSolid(gx,gy)) continue;
      // И только если стенка ТОЛЩЕ пятна, которым призрак мажет. Сам он внутри
      // стенки, но мажет кругом радиуса R, и сквозь тонкую перегородку это
      // пятно просвечивает: с той стороны рисуется вода, которой там нет.
      // Проверяем точку на глубину пятна дальше — если там уже не твёрдо,
      // стенка тонкая, и призрака не ставим.
      if (!inSolid(gx-R*nx, gy-R*ny)) continue;
      splatAt(gx,gy);
    }
    return used;
  }
  /* Обход задан так, что «внутри» всегда слева по ходу ⇒ петли замкнуты,
     дырки намотаны в обратную сторону ⇒ fill-rule evenodd работает. */
  contour(iso, smooth){
    const nx=this.nx, cs=this.cs, ox=this.ox, oy=this.oy, S=this.scale;
    const f=this.field, next=this.next, ptx=this.ptx, pty=this.pty, starts=this.starts;
    const r=this.rect;
    if (!r){ this.lastVerts=0; return ''; }
    const cx0=Math.max(0,r[0]-1), cy0=Math.max(0,r[1]-1);
    const cx1=Math.min(nx-2,r[2]), cy1=Math.min(this.ny-2,r[3]);
    let ns=0;
    for (let y=cy0;y<=cy1;y++){
      const r0=y*nx, r1=r0+nx;
      for (let x=cx0;x<=cx1;x++){
        const a=f[r0+x], b=f[r0+x+1], c=f[r1+x+1], d=f[r1+x];
        let code=0;
        if (a>iso) code|=1; if (b>iso) code|=2; if (c>iso) code|=4; if (d>iso) code|=8;
        if (code===0||code===15) continue;
        let idT=-1, idR=-1, idB=-1, idL=-1;
        if ((code&3)===1||(code&3)===2){
          idT=((y*nx+x)<<1); const t=(iso-a)/(b-a);
          ptx[idT]=(ox+(x+t)*cs)*S; pty[idT]=(oy+y*cs)*S;
        }
        if (((code>>1)&3)===1||((code>>1)&3)===2){
          idR=(((y*nx+x+1)<<1)|1); const t=(iso-b)/(c-b);
          ptx[idR]=(ox+(x+1)*cs)*S; pty[idR]=(oy+(y+t)*cs)*S;
        }
        if (((code>>2)&3)===1||((code>>2)&3)===2){
          idB=(((y+1)*nx+x)<<1); const t=(iso-d)/(c-d);
          ptx[idB]=(ox+(x+t)*cs)*S; pty[idB]=(oy+(y+1)*cs)*S;
        }
        if (((code&1)!==0)!==((code&8)!==0)){
          idL=(((y*nx+x)<<1)|1); const t=(iso-a)/(d-a);
          ptx[idL]=(ox+x*cs)*S; pty[idL]=(oy+(y+t)*cs)*S;
        }
        let s0=-1, s1=-1;
        switch (code){
          case 1:  next[idL]=idT; s0=idL; break;
          case 2:  next[idT]=idR; s0=idT; break;
          case 3:  next[idL]=idR; s0=idL; break;
          case 4:  next[idR]=idB; s0=idR; break;
          case 5:  next[idL]=idT; next[idR]=idB; s0=idL; s1=idR; break;
          case 6:  next[idT]=idB; s0=idT; break;
          case 7:  next[idL]=idB; s0=idL; break;
          case 8:  next[idB]=idL; s0=idB; break;
          case 9:  next[idB]=idT; s0=idB; break;
          case 10: next[idT]=idR; next[idB]=idL; s0=idT; s1=idB; break;
          case 11: next[idB]=idR; s0=idB; break;
          case 12: next[idR]=idL; s0=idR; break;
          case 13: next[idR]=idT; s0=idR; break;
          case 14: next[idT]=idL; s0=idT; break;
        }
        if (s0>=0) starts[ns++]=s0;
        if (s1>=0) starts[ns++]=s1;
      }
    }
    let out='', verts=0;
    const A=this.bufA, B=this.bufB;
    for (let k=0;k<ns;k++){
      const id=starts[k];
      if (next[id]<0) continue;
      let cur=id, len=0;
      while (cur>=0 && next[cur]>=0 && len<30000){
        const nn=next[cur]; next[cur]=-1;
        A[len*2]=ptx[cur]; A[len*2+1]=pty[cur];
        cur=nn; len++;
      }
      if (len<4) continue;
      let src=A, dst=B, m=len;
      for (let it=0;it<smooth;it++){
        if (m*4>src.length) break;
        for (let i=0;i<m;i++){
          const j=(i+1)%m;
          const x0=src[i*2], y0=src[i*2+1], x1=src[j*2], y1=src[j*2+1];
          dst[i*4]=0.75*x0+0.25*x1;   dst[i*4+1]=0.75*y0+0.25*y1;
          dst[i*4+2]=0.25*x0+0.75*x1; dst[i*4+3]=0.25*y0+0.75*y1;
        }
        const t=src; src=dst; dst=t; m*=2;
      }
      // Прореживаем перед выводом. Сглаживание учетверяет число вершин, а
      // поверхность воды по большей части плавная: там, где ломаная и так
      // укладывается в допуск, лишние точки не несут ничего, кроме длины
      // строки. Путь переприсваивается в разметку каждый кадр, и его размер
      // — это то, чем платит браузер, а не решатель.
      const keep = simplify(src, m, SIMPLIFY);
      out+='M'+(Math.round(src[keep[0]*2]*10)/10)+' '+(Math.round(src[keep[0]*2+1]*10)/10);
      for (let i=1;i<keep.length;i++) out+='L'+(Math.round(src[keep[i]*2]*10)/10)+' '+(Math.round(src[keep[i]*2+1]*10)/10);
      out+='Z';
      verts+=keep.length;
    }
    this.lastVerts=verts;
    return out;
  }
  /* Контур произвольного поля целиком (используется для грунта). */
  contourField(src, iso, smooth){
    this.field.set(src);
    this.rect=[0,0,this.nx-2,this.ny-2];
    this.prev=null;
    const d=this.contour(iso, smooth);
    this.rect=null;
    return d;
  }
}
/* Значение поля в толще жидкости: Σ(1−q²)² по гексагональной укладке. */
export function bulkFieldValue(R, d){ return Math.PI*R*R/(3*0.8660254*d*d); }

