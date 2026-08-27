// Ядро исходной реализации, извлечённое как есть, без единой правки.
// Нужно стенду bench-ref.html, чтобы сравнивать с движком один и тот же
// алгоритм. Править этот файл нельзя — он эталон.

/* =========================================================================
   core/kernels.js — ядра SPH в 2D
   ========================================================================= */
function makeKernels(h){
  const h2 = h*h;
  const POLY6 = 4 / (Math.PI * Math.pow(h, 8));   // W(r) = POLY6 * (h²-r²)³
  const SPIKY = -30 / (Math.PI * Math.pow(h, 5)); // ∇W(r) = SPIKY*(h-r)² * r̂
  return { h, h2, POLY6, SPIKY };
}

/* Сплайн когезии (Akinci et al. 2013, «Versatile Surface Tension and Adhesion
   for SPH Fluids»). Ключевое отличие от монотонного притяжения: C(r) обращается
   в ноль И на r=h, И на r=0, а максимум держит около r≈0.75h. Поэтому близкие
   частицы не слипаются в комки — сила отталкивает их обратно на равновесное
   расстояние, а тянет только тех, кто дальше. */
function cohSpline(r, h, A){
  if (r<=0 || r>=h) return 0;
  const a=h-r, t=a*a*a*r*r*r;
  return A*(2*r>h ? t : 2*t - h*h*h*h*h*h/64);
}

/* Сплайн прилипания к стенке (Akinci 2013, §4). Ноль при r=h и при r=h/2,
   максимум посередине: далёкая частица стенку не чувствует, а прижатая
   вплотную не получает бесконечной тяги. Нормирован на единицу в максимуме,
   поэтому коэффициент задаётся прямо в м/с². */
function adhSpline(r, h){
  if (2*r<=h || r>=h) return 0;
  const v=-4*r*r/h + 6*r - 2*h;
  return v<=0 ? 0 : Math.pow(v/(0.75*h), 0.25);
}

/* Калибровка по гексагональной решётке с шагом d: даёт плотность покоя при m=1
   и типичное Σ|∇C|². Все параметры ниже становятся безразмерными. */
function calibrate(h, d){
  const K = makeKernels(h);
  let rho = K.POLY6 * K.h2*K.h2*K.h2;
  let gsum = 0, gx = 0, gy = 0;
  const dy = d * Math.sqrt(3) / 2;
  const R = Math.ceil(h/Math.min(d,dy)) + 2;
  for (let j = -R; j <= R; j++){
    for (let i = -R; i <= R; i++){
      if (i === 0 && j === 0) continue;
      const x = i*d + (j & 1 ? d*0.5 : 0), y = j*dy;
      const r2 = x*x + y*y;
      if (r2 >= K.h2) continue;
      const t = K.h2 - r2;
      rho += K.POLY6 * t*t*t;
      const r = Math.sqrt(r2);
      const c = K.SPIKY * (h-r)*(h-r) / r;
      gx += c*x; gy += c*y; gsum += c*c*r2;
    }
  }
  return { rhoUnit: rho, gradSum: (gsum + gx*gx + gy*gy) / (rho*rho) };
}

/* =========================================================================
   core/sdf.js — тела как signed distance fields
   ========================================================================= */
function sdf(s, x, y){
  switch (s.k){
    case 'box': {
      let lx = x - s.x, ly = y - s.y;
      if (s.a){
        const c = Math.cos(-s.a), sn = Math.sin(-s.a);
        const t = c*lx - sn*ly; ly = sn*lx + c*ly; lx = t;
      }
      const qx = Math.abs(lx) - s.hw, qy = Math.abs(ly) - s.hh;
      const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0;
      return Math.sqrt(mx*mx + my*my) + Math.min(Math.max(qx, qy), 0);
    }
    case 'circle': {
      const dx = x - s.x, dy = y - s.y;
      return Math.sqrt(dx*dx + dy*dy) - s.r;
    }
    case 'room': {
      const qx = Math.abs(x - s.x) - s.hw, qy = Math.abs(y - s.y) - s.hh;
      const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0;
      return -(Math.sqrt(mx*mx + my*my) + Math.min(Math.max(qx, qy), 0));
    }
    case 'terrain': return s.ref.sampleDist(x, y);
  }
  return 1e9;
}
function sdfGrad(s, x, y, out){
  const e = s.k === 'terrain' ? s.ref.cs*0.6 : 1e-4;
  let gx = sdf(s, x+e, y) - sdf(s, x-e, y);
  let gy = sdf(s, x, y+e) - sdf(s, x, y-e);
  const l = Math.hypot(gx, gy);
  if (l < 1e-12){ out[0] = 0; out[1] = -1; return; }
  out[0] = gx/l; out[1] = gy/l;
}

/* =========================================================================
   core/terrain.js — копаемый грунт: занятость + знаковое расстояние (chamfer)
   ========================================================================= */
class Terrain {
  constructor(nx, ny, cs, ox, oy){
    this.nx=nx; this.ny=ny; this.cs=cs; this.ox=ox; this.oy=oy;
    const N = nx*ny;
    this.occ  = new Uint8Array(N);
    this.dist = new Float32Array(N);
    this.din  = new Float32Array(N);
    this.dout = new Float32Array(N);
    this.dist.fill(1e6);
    this.version = 0;
    this.x0=0; this.x1=0; this.y0=0; this.y1=0; this.any=false;
  }
  fillRect(ax, ay, bx, by){
    const {nx,ny,cs,ox,oy,occ} = this;
    for (let y=0;y<ny;y++){
      const wy = oy + y*cs;
      if (wy < ay || wy > by) continue;
      for (let x=0;x<nx;x++){
        const wx = ox + x*cs;
        if (wx < ax || wx > bx) continue;
        occ[y*nx+x] = 1;
      }
    }
  }
  dig(px, py, r){
    const {nx,ny,cs,ox,oy,occ} = this;
    let x0=Math.floor((px-r-ox)/cs), x1=Math.ceil((px+r-ox)/cs);
    let y0=Math.floor((py-r-oy)/cs), y1=Math.ceil((py+r-oy)/cs);
    if (x0<0)x0=0; if(y0<0)y0=0; if(x1>nx-1)x1=nx-1; if(y1>ny-1)y1=ny-1;
    const r2=r*r; let hit=0;
    for (let y=y0;y<=y1;y++){
      const wy=oy+y*cs-py;
      for (let x=x0;x<=x1;x++){
        const wx=ox+x*cs-px;
        if (wx*wx+wy*wy > r2) continue;
        const i=y*nx+x;
        if (occ[i]){ occ[i]=0; hit=1; }
      }
    }
    return hit;
  }
  /* Двухпроходный chamfer: din — до свободной клетки, dout — до твёрдой. */
  rebuild(){
    const {nx,ny,occ,din,dout,dist,cs} = this;
    const N = nx*ny, INF = 1e6;
    for (let i=0;i<N;i++){ din[i] = occ[i]?INF:0; dout[i] = occ[i]?0:INF; }
    const A=1, B=Math.SQRT2;
    const sweep=(f)=>{
      for (let y=0;y<ny;y++){
        const row=y*nx;
        for (let x=0;x<nx;x++){
          const i=row+x; let v=f[i];
          if (x>0 && f[i-1]+A<v) v=f[i-1]+A;
          if (y>0){
            if (f[i-nx]+A<v) v=f[i-nx]+A;
            if (x>0 && f[i-nx-1]+B<v) v=f[i-nx-1]+B;
            if (x<nx-1 && f[i-nx+1]+B<v) v=f[i-nx+1]+B;
          }
          f[i]=v;
        }
      }
      for (let y=ny-1;y>=0;y--){
        const row=y*nx;
        for (let x=nx-1;x>=0;x--){
          const i=row+x; let v=f[i];
          if (x<nx-1 && f[i+1]+A<v) v=f[i+1]+A;
          if (y<ny-1){
            if (f[i+nx]+A<v) v=f[i+nx]+A;
            if (x<nx-1 && f[i+nx+1]+B<v) v=f[i+nx+1]+B;
            if (x>0 && f[i+nx-1]+B<v) v=f[i+nx-1]+B;
          }
          f[i]=v;
        }
      }
    };
    sweep(din); sweep(dout);
    let x0=nx, x1=-1, y0=ny, y1=-1, any=false;
    for (let y=0;y<ny;y++){
      const row=y*nx;
      for (let x=0;x<nx;x++){
        const i=row+x;
        dist[i] = occ[i] ? -(din[i]-0.5)*cs : (dout[i]-0.5)*cs;
        if (occ[i]){ any=true;
          if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
      }
    }
    this.any=any;
    this.x0=this.ox+x0*this.cs; this.x1=this.ox+x1*this.cs;
    this.y0=this.oy+y0*this.cs; this.y1=this.oy+y1*this.cs;
    this.version++;
  }
  sampleDist(x, y){
    const {nx,ny,cs,ox,oy,dist} = this;
    let gx=(x-ox)/cs, gy=(y-oy)/cs;
    let ix=Math.floor(gx), iy=Math.floor(gy);
    if (ix<0) ix=0; else if (ix>nx-2) ix=nx-2;
    if (iy<0) iy=0; else if (iy>ny-2) iy=ny-2;
    const fx=gx-ix, fy=gy-iy, r0=iy*nx+ix, r1=r0+nx;
    const a=dist[r0], b=dist[r0+1], c=dist[r1], d=dist[r1+1];
    return (a+(b-a)*fx) + ((c+(d-c)*fx) - (a+(b-a)*fx))*fy;
  }
}

/* Таблица пополнения плотности у границы.
   f(s) — доля интеграла ядра, ушедшая за плоскую стенку на расстоянии s;
   l(s) — интеграл ядра вдоль самой стенки (это −f'(s)).            */
function buildBoundaryTable(h, P6){
  const N=256, f=new Float32Array(N+1), l=new Float32Array(N+1);
  const h2=h*h, M=192;
  for (let k=0;k<=N;k++){
    const s=h*k/N;
    // l(s): интеграл вдоль линии x=s
    const ym=Math.sqrt(Math.max(0,h2-s*s));
    let acc=0; const dy=2*ym/M;
    for (let m=0;m<M;m++){
      const y=-ym+(m+0.5)*dy, r2=s*s+y*y;
      if (r2>=h2) continue;
      const t=h2-r2; acc+=P6*t*t*t*dy;
    }
    l[k]=acc;
  }
  // f(s) = ∫_s^h l(x) dx, трапеции справа налево
  const dx=h/N;
  f[N]=0;
  for (let k=N-1;k>=0;k--) f[k]=f[k+1]+0.5*(l[k]+l[k+1])*dx;
  return { f, l, inv: N/h };
}

/* =========================================================================
   core/solver.js — Position Based Fluids (Macklin & Müller 2013)
   + под-релаксация Якоби (параллельное решение ⇒ ω < 1)
   + «малые шаги» (Macklin 2019): бюджет в подшаги, а не в итерации
   ========================================================================= */
class FluidSolver {
  constructor(opt){
    const M = this.max = opt.maxParticles;
    this.h = opt.h; this.h2 = this.h*this.h;
    this.spacing = opt.spacing;
    // Ровно полшага: центр частицы стоит в полушаге от стенки, поэтому
    // граница жидкости совпадает со стенкой, а отладочная точка диаметром
    // в один шаг касается пола там же, где изоповерхность.
    this.pRadius = opt.spacing * 0.5;
    this.W = opt.width; this.H = opt.height;
    this.n = 0;

    const K = makeKernels(this.h);
    this.POLY6 = K.POLY6; this.SPIKY = K.SPIKY;
    // Нормировка сплайна когезии Akinci: ∫C dA = 1 по кругу радиуса h.
    {
      const h=this.h, M=2048; let acc=0;
      for (let m=0;m<M;m++){
        const r=h*(m+0.5)/M;
        acc += cohSpline(r,h,1)*2*Math.PI*r*(h/M);
      }
      this.COH = 1/acc;
    }
    const cal = calibrate(this.h, this.spacing);
    this.rhoUnit = cal.rhoUnit;
    this.gradSum = cal.gradSum;

    const F = () => new Float32Array(M);
    this.x=F(); this.y=F(); this.vx=F(); this.vy=F();
    this.px=F(); this.py=F(); this.ax=F(); this.ay=F();
    this.rho=F(); this.lam=F(); this.mass=F(); this.rest=F();
    this.om=F(); this.cnx=F(); this.cny=F(); this.cvx=F(); this.cvy=F();
    this.type = new Uint8Array(M); this.flag = new Uint8Array(M);

    this.MAXN = 40;
    this.nbr = new Int32Array(M*this.MAXN);
    this.nc  = new Int32Array(M);
    // Кэш ядра между computeLambda и applyDeltaP: внутри одной итерации
    // позиции не меняются, а корень и деление там считались дважды.
    this.nkc = new Float32Array(M*this.MAXN);   // SP·(h−r)²/r
    this.nkw = new Float32Array(M*this.MAXN);   // W_poly6(r)

    this.cell = this.h;
    this.gnx = Math.ceil(this.W/this.cell) + 1;
    this.gny = Math.ceil(this.H/this.cell) + 1;
    this.cStart = new Int32Array(this.gnx*this.gny + 1);
    this.cCur   = new Int32Array(this.gnx*this.gny + 1);
    this.cOf    = new Int32Array(M);
    this.sorted = new Int32Array(M);

    this.bs=F(); this.bnx=F(); this.bny=F(); this.bf=F(); this.bpsi=F();
    this.stx=F(); this.sty=F();   // ускорение от поверхностного натяжения
    this.snx=F(); this.sny=F(); this.sax=F(); this.say=F();
    this.surf=new Uint8Array(M);  // кто сейчас лежит на свободной поверхности
    this.bTable = buildBoundaryTable(this.h, this.POLY6);

    this.colliders = [];
    this.gx = 0; this.gy = 9.8;
    this.massDensity = true; this.archimedes = 1;
    this.useBoundary = 1; this.useFriction = 1; this.clampV = 1; this.restitution = 1; this.tensile = 0.05; this.adhesion = 0; this.invRef = 1/1000;
    this.iters = 2; this.omega = 0.8; this.relax = 0.1; this.tension = 0.6;
    this.film = 0; this.surfLevel = 0.5;
    this.viscosity = 0.03; this.cohesion = 5; this.vorticity = 0.1; this.friction = 0.15;
    this.tmpN = [0, 0];
  }

  addParticle(x, y, vx, vy, type, rest0){
    if (this.n >= this.max) return false;
    const i = this.n++;
    this.x[i]=x; this.y[i]=y; this.vx[i]=vx; this.vy[i]=vy;
    this.type[i]=type; this.rest[i]=rest0;
    this.mass[i]=rest0/this.rhoUnit;
    this.rho[i]=rest0; this.lam[i]=0; this.flag[i]=0;
    this.bs[i]=this.h;   // до первого sampleBoundary частица считается вдали от стенок
    return true;
  }
  remove(i){
    const l = --this.n;
    if (i !== l){
      this.x[i]=this.x[l]; this.y[i]=this.y[l];
      this.vx[i]=this.vx[l]; this.vy[i]=this.vy[l];
      this.mass[i]=this.mass[l]; this.rest[i]=this.rest[l];
      this.type[i]=this.type[l]; this.rho[i]=this.rho[l];
    }
  }
  clear(){ this.n = 0; }

  updateBounds(){
    const R = this.h;   // широкая фаза общая для контактов и для границы
    for (const s of this.colliders){
      if (s.k === 'circle'){
        s._x0=s.x-s.r-R; s._x1=s.x+s.r+R; s._y0=s.y-s.r-R; s._y1=s.y+s.r+R; s.inv=false;
      } else if (s.k === 'room'){
        s._x0=s.x-s.hw+R; s._x1=s.x+s.hw-R; s._y0=s.y-s.hh+R; s._y1=s.y+s.hh-R; s.inv=true;
      } else if (s.k === 'terrain'){
        const t=s.ref, m=t.cs*2+R;
        s._x0=t.x0-m; s._x1=t.x1+m; s._y0=t.y0-m; s._y1=t.y1+m;
        s.inv=false; s.skip=!t.any;
      } else {
        const c=Math.abs(Math.cos(s.a||0)), sn=Math.abs(Math.sin(s.a||0));
        const ex=s.hw*c+s.hh*sn+R, ey=s.hw*sn+s.hh*c+R;
        s._x0=s.x-ex; s._x1=s.x+ex; s._y0=s.y-ey; s._y1=s.y+ey; s.inv=false;
      }
    }
  }

  buildGrid(){
    const n=this.n, px=this.px, py=this.py;
    const inv=1/this.cell, gnx=this.gnx, gny=this.gny;
    const cs=this.cStart, cc=this.cCur, cof=this.cOf, sr=this.sorted;
    cs.fill(0);
    for (let i=0;i<n;i++){
      let cx=px[i]*inv|0, cy=py[i]*inv|0;
      if (cx<0) cx=0; else if (cx>=gnx) cx=gnx-1;
      if (cy<0) cy=0; else if (cy>=gny) cy=gny-1;
      const c=cy*gnx+cx; cof[i]=c; cs[c+1]++;
    }
    const total=gnx*gny;
    for (let c=0;c<total;c++) cs[c+1]+=cs[c];
    cc.set(cs);
    for (let i=0;i<n;i++) sr[cc[cof[i]]++]=i;
  }

  buildNeighbors(){
    const n=this.n, px=this.px, py=this.py, h2=this.h2;
    const gnx=this.gnx, gny=this.gny, inv=1/this.cell;
    const cs=this.cStart, sr=this.sorted, nbr=this.nbr, nc=this.nc, MAXN=this.MAXN;
    for (let i=0;i<n;i++){
      const xi=px[i], yi=py[i];
      let cx=xi*inv|0, cy=yi*inv|0;
      if (cx<0) cx=0; else if (cx>=gnx) cx=gnx-1;
      if (cy<0) cy=0; else if (cy>=gny) cy=gny-1;
      const x0=cx>0?cx-1:0, x1=cx<gnx-1?cx+1:gnx-1;
      const y0=cy>0?cy-1:0, y1=cy<gny-1?cy+1:gny-1;
      let cnt=0; const base=i*MAXN;
      for (let yy=y0;yy<=y1;yy++){
        const row=yy*gnx;
        for (let xx=x0;xx<=x1;xx++){
          const c=row+xx, e=cs[c+1];
          for (let k=cs[c];k<e;k++){
            const j=sr[k];
            if (j===i) continue;
            const dx=xi-px[j], dy=yi-py[j];
            if (dx*dx+dy*dy>=h2) continue;
            nbr[base+cnt]=j;
            if (++cnt>=MAXN){ yy=y1; xx=x1; break; }
          }
        }
      }
      nc[i]=cnt;
    }
  }

  /* Ближайшая стенка для каждой частицы: расстояние + нормаль.
     Нужна не только для контактов — без неё частица у стенки считается
     разреженной (часть ядра уходит в твёрдое тело) и её отжимает от берега. */
  sampleBoundary(){
    const n=this.n, px=this.px, py=this.py, h=this.h;
    const bs=this.bs, bnx=this.bnx, bny=this.bny, cs=this.colliders, nrm=this.tmpN;
    bs.fill(h, 0, n);
    for (let s=0;s<cs.length;s++){
      const sh=cs[s];
      if (sh.skip) continue;
      const x0=sh._x0, x1=sh._x1, y0=sh._y0, y1=sh._y1, inv=sh.inv;
      for (let i=0;i<n;i++){
        const xi=px[i], yi=py[i];
        if (inv){ if (xi>x0&&xi<x1&&yi>y0&&yi<y1) continue; }
        else     { if (xi<x0||xi>x1||yi<y0||yi>y1) continue; }
        const d=sdf(sh, xi, yi);
        if (d>=bs[i]) continue;
        sdfGrad(sh, xi, yi, nrm);
        bs[i]=d>0?d:0; bnx[i]=nrm[0]; bny[i]=nrm[1];
      }
    }
  }

  computeLambda(){
    const n=this.n, px=this.px, py=this.py, h=this.h, h2=this.h2;
    const P6=this.POLY6, SP=this.SPIKY, mass=this.mass, rest=this.rest;
    const nbr=this.nbr, nc=this.nc, MAXN=this.MAXN, rho=this.rho, lam=this.lam;
    const bs=this.bs, bnx=this.bnx, bny=this.bny;
    const nkc=this.nkc, nkw=this.nkw;
    const EPS = this.relax * this.gradSum;
    for (let i=0;i<n;i++){
      const xi=px[i], yi=py[i], invR=1/rest[i];
      // Плотность по КОНТРАСТУ (Solenthaler & Pajarola 2008): в сумму идёт
      // собственная масса частицы, а не масса соседа. Иначе капля масла на
      // границе с водой видит тяжёлых соседей, считается пересжатой, и её
      // выпучивает вверх бугром вместо ровной глади.
      const MD=this.massDensity;
      let w = P6*h2*h2*h2*(MD?mass[i]:1);
      // Счётная плотность — та же сумма ядер, но БЕЗ масс. Она не зависит от
      // фазы и отвечает на единственный вопрос: есть ли рядом пустота.
      let wn = P6*h2*h2*h2;
      let gix=0, giy=0, sum=0;
      const base=i*MAXN, cnt=nc[i], invU=MD?(1/rest[i]):(1/this.rhoUnit);
      for (let k=0;k<cnt;k++){
        const j=nbr[base+k];
        const dx=xi-px[j], dy=yi-py[j];
        const r2=dx*dx+dy*dy;
        if (r2>=h2 || r2<1e-14){ nkc[base+k]=0; continue; }
        const t=h2-r2, mj=MD?mass[j]:1;
        const wk=P6*t*t*t;
        w += mj*wk; wn += wk;
        const rr=Math.sqrt(r2);
        const kc=SP*(h-rr)*(h-rr)/rr;
        nkc[base+k]=kc; nkw[base+k]=wk;
        const c=kc*invU*mj;
        const gx=c*dx, gy=c*dy;
        gix+=gx; giy+=gy; sum+=gx*gx+gy*gy;
      }
      let r = MD?w:(mass[i]*w);
      const sb=this.useBoundary?bs[i]:h;
      if (sb<h){
        const t=this.bTable, k=sb*t.inv|0;
        // ψ — насколько зеркало за стенкой ЗАПОЛНЕНО настоящей жидкостью:
        // отношение плотности, набранной по соседям, к той, что даёт сплошная
        // среда на этом расстоянии от стенки. У борта полного таза ψ≈1,
        // у одинокой капли отражать нечего и ψ≈0.
        const full=(1-t.f[k])*rest[i];
        const ps = full>1e-9 ? r/full : 0;
        this.bpsi[i] = ps>1 ? 1 : (ps<0 ? 0 : ps);
        r += rest[i]*t.f[k];              // недостающая масса за стенкой
        wn += this.rhoUnit*t.f[k];        // и то же самое для счётной плотности
        const g=-t.l[k];                  // d/ds ∫W = −∫W вдоль линии
        gix += g*bnx[i]; giy += g*bny[i];
      } else this.bpsi[i]=0;
      rho[i]=r;
      // Признак свободной поверхности — модуль градиента ограничения (он уже
      // посчитан). Замерено: у верхнего ряда |∇C|·h = 0.7…1.5, в толще и у
      // стенок ≤0.25. По плотности порога нет вовсе: у верхнего ряда она
      // гуляет 0.73…1.0 и перекрывается с толщей. Множитель h делает признак
      // независимым от шага частиц.
      // Тот же счётный признак нужен и плёнке: на границе фаз |∇C| велик
      // (плотность по массам там прыгает), и без этой проверки плёнка
      // считала бы межфазную границу свободной поверхностью и выпрямляла
      // её изнутри жидкости — остаточное кипение масла шло отсюда.
      const gl=Math.sqrt(gix*gix+giy*giy);
      if (gl*h > this.surfLevel && wn < 0.95*this.rhoUnit){
        this.surf[i]=1; this.snx[i]=-gix/gl; this.sny[i]=-giy/gl;
      } else this.surf[i]=0;
      sum += gix*gix+giy*giy;
      // Давление в жидкости со свободной поверхностью не бывает отрицательным:
      // вода не тянет, она кавитирует. Недоуплотнённая приповерхностная
      // частица должна иметь p=0, а не тянуть соседей внутрь. Сцепление даёт
      // отдельный член когезии, а растягивающие напряжения — это и есть
      // источник вечного дрожания тонких слоёв.
      const C = r*invR - 1;
      // Растягивающее давление допустимо ТОЛЬКО у свободной поверхности, где
      // рядом действительно пусто. На границе фаз плотность по массам тоже
      // проседает — вода под маслом видит лёгких соседей и считается
      // разреженной, — но пустоты там нет, и тянуть соседей внутрь не за чем.
      // Именно эта ложная тяга и раскачивала толстый слой масла без остановки:
      // вода подтягивалась вверх, Архимед возвращал масло назад, и так по
      // кругу. Различаем по СЧЁТНОЙ плотности: у свободной поверхности она
      // 0.73…0.90 от решёточной, на границе фаз — единица.
      const tens = wn < 0.95*this.rhoUnit ? this.tensile : 0;
      // Solenthaler & Pajarola: ограничение по УПАКОВКЕ (граница фаз резкая),
      // а масса входит в ДАВЛЕНИЕ (остаётся всплытие). При MD=true — обычная
      // формулировка по массе соседей.
      const kP = MD ? 1 : rest[i]*this.invRef;
      lam[i] = -kP*(C < 0 ? C*tens : C)/(sum + EPS);
    }
  }

  applyDeltaP(){
    const n=this.n, px=this.px, py=this.py, h=this.h, h2=this.h2;
    const P6=this.POLY6, SP=this.SPIKY, mass=this.mass, rest=this.rest;
    const nbr=this.nbr, nc=this.nc, MAXN=this.MAXN, lam=this.lam;
    const bs=this.bs, bnx=this.bnx, bny=this.bny;
    const ax=this.ax, ay=this.ay;
    const dq=0.2*h, invWq=1/(P6*Math.pow(h2-dq*dq,3));
    const invU=1/this.rhoUnit, MD=this.massDensity;
    const nkc=this.nkc, nkw=this.nkw;
    const K=this.tension/this.gradSum;
    for (let i=0;i<n;i++){
      const xi=px[i], yi=py[i], li=lam[i], mi=mass[i], iri=1/rest[i];
      let sx=0, sy=0;
      const base=i*MAXN, cnt=nc[i];
      for (let k=0;k<cnt;k++){
        const kc=nkc[base+k];
        if (kc===0) continue;                  // ядро уже посчитано в λ
        const j=nbr[base+k];
        const dx=xi-px[j], dy=yi-py[j];
        let scorr=0;
        if (K>0){ const q=nkw[base+k]*invWq, q2=q*q; scorr=-K*q2*q2; }
        // 2·m_j/(m_i+m_j) — развесовка PBD по обратной массе: лёгкая частица
        // сдвигается сильнее тяжёлой, откуда и берётся всплытие.
        const wij = mass[j]*iri;
        const c=kc*wij*(li+lam[j]+scorr);
        sx+=c*dx; sy+=c*dy;
      }
      const sb=this.useBoundary?bs[i]:h;
      if (sb<h){
        // Отталкивание (λ<0) стенка отрабатывает всегда. Тянуть частицу К себе
        // (λ>0 — растяжение) она вправе ровно настолько, насколько зеркало за
        // ней заполнено жидкостью: у борта полного таза ψ≈1, симметрия с
        // соседями сохраняется и урез не проседает; у одинокой капли ψ≈0 —
        // клея нет, капля падает. Полный запрет притяжения (lb=0) капли лечил,
        // но ронял крайний столбец на треть шага: замерено 3.1 px против 0.3.
        const ps=this.bpsi[i];
        const lb = li<0 ? li : 0;   // решатель стенкой только отталкивает; смачивание — отдельной силой
        const t=this.bTable, k=sb*t.inv|0, g=-t.l[k]*lb;
        sx += g*bnx[i]; sy += g*bny[i];
      }
      ax[i]=sx; ay[i]=sy;
    }
    // Якоби решает все ограничения одновременно, соседи двигаются навстречу
    // друг другу ⇒ сумма коррекций перелетает. ω — стандартная под-релаксация.
    const w=this.omega;
    for (let i=0;i<n;i++){ px[i]+=ax[i]*w; py[i]+=ay[i]*w; }
  }

  /* ====================================================================
     ПЛЁНКА — связь, живущая только на свободной поверхности.

     Зачем. Верхний ряд набивается плотнее, чем помещается по длине (замерено
     0.907 d против 1.05 d в толще): лишним частицам некуда деться, потому что
     давление у свободной поверхности равно нулю и внутрь их ничто не гонит.
     Пересжатый ряд ведёт себя как сжатый стержень — теряет устойчивость и
     выпучивается. Отсюда и «неровный уровень», который не лечится ни
     натяжением, ни сходимостью решателя.

     Что делаем. Берём двух ближайших соседей ПО ПЛЁНКЕ (a и b) и требуем,
     чтобы i лежала на отрезке между ними — но только по нормали:
         C = (x_i − (x_a+x_b)/2)·n̂ = 0.
     Это дискретная кривизна цепочки, то есть натяжение в его геометрическом
     виде. Плоская плёнка — прямая (C≡0 и связь молчит), капля — окружность
     (C одинаков по периметру, а ограничение плотности отвечает лапласовым
     давлением и не даёт схлопнуться). Касательную часть выбрасываем: иначе
     частицы поехали бы вдоль плёнки и сбились в комки.

     Почему двое соседей, а не среднее по ядру: среднее подмешивает вторых
     соседей вдоль цепочки, оператор перестаёт быть диагонально доминирующим
     и при жёсткости выше 0.3 идёт вразнос (замерено: σ 0.7 → 8.9 px).
     Отдачу делим поровну между a и b — импульс сохраняется, ряд не всплывает.
     ==================================================================== */
  smoothFilm(){
    const st=this.film;
    if (st<=0) return;
    const n=this.n, px=this.px, py=this.py, h2=this.h2;
    const nbr=this.nbr, nc=this.nc, MAXN=this.MAXN, tp=this.type;
    const surf=this.surf, snx=this.snx, sny=this.sny;
    const sax=this.sax, say=this.say;
    const lim=0.04*this.spacing;   // шаг связи ограничен: без клипа она идёт вразнос при жёсткости выше 0.35
    sax.fill(0,0,n); say.fill(0,0,n);
    for (let i=0;i<n;i++){
      if (!surf[i]) continue;
      const xi=px[i], yi=py[i], ti=tp[i];
      const base=i*MAXN, cnt=nc[i];
      const nx=snx[i], ny=sny[i], tx=-ny, ty=nx;
      // Соседей берём ПО ОДНОМУ С КАЖДОЙ СТОРОНЫ вдоль касательной. Просто
      // «двое ближайших» то и дело оказываются с одной стороны — там, где
      // плёнка локально в две частицы, — и кривизна выходит фиктивной.
      let a=-1, b=-1, r1=1e9, r2=1e9;
      for (let k=0;k<cnt;k++){
        const j=nbr[base+k];
        if (!surf[j] || tp[j]!==ti) continue;
        const dx=px[j]-xi, dy=py[j]-yi;
        const rr=dx*dx+dy*dy;
        if (rr>=h2) continue;
        const sgn=dx*tx+dy*ty;
        if (sgn>0){ if (rr<r1){ r1=rr; a=j; } }
        else if (sgn<0){ if (rr<r2){ r2=rr; b=j; } }
      }
      if (a<0 || b<0) continue;                // край плёнки — выпрямлять нечего
      const mx=0.5*(px[a]+px[b]), my=0.5*(py[a]+py[b]);
      const C=(xi-mx)*nx + (yi-my)*ny;
      // Σ|∇C|² = 1 + ¼ + ¼
      let lam=-st*C/1.5;
      if (lam>lim) lam=lim; else if (lam<-lim) lam=-lim;
      sax[i]+=lam*nx;      say[i]+=lam*ny;
      const half=0.5*lam;
      sax[a]-=half*nx; say[a]-=half*ny;
      sax[b]-=half*nx; say[b]-=half*ny;
    }
    for (let i=0;i<n;i++){ px[i]+=sax[i]; py[i]+=say[i]; }
  }

  solveColliders(){
    const n=this.n, px=this.px, py=this.py, R=this.pRadius;
    const cs=this.colliders, nrm=this.tmpN;
    const flag=this.flag, cnx=this.cnx, cny=this.cny, cvx=this.cvx, cvy=this.cvy;
    flag.fill(0, 0, n);
    for (let s=0;s<cs.length;s++){
      const sh=cs[s];
      if (sh.skip) continue;
      const x0=sh._x0, x1=sh._x1, y0=sh._y0, y1=sh._y1, inv=sh.inv;
      const svx=sh.vx||0, svy=sh.vy||0;
      for (let i=0;i<n;i++){
        const xi=px[i], yi=py[i];
        if (inv){ if (xi>x0&&xi<x1&&yi>y0&&yi<y1) continue; }
        else     { if (xi<x0||xi>x1||yi<y0||yi>y1) continue; }
        const d=sdf(sh, xi, yi);
        if (d>=R) continue;
        sdfGrad(sh, xi, yi, nrm);
        const push=R-d;
        px[i]=xi+nrm[0]*push; py[i]=yi+nrm[1]*push;
        flag[i]=1; cnx[i]=nrm[0]; cny[i]=nrm[1]; cvx[i]=svx; cvy[i]=svy;
      }
    }
    this.clampWorld();
  }

  clampWorld(){
    const n=this.n, px=this.px, py=this.py, e=this.pRadius;
    const W=this.W-e, H=this.H-e;
    for (let i=0;i<n;i++){
      if (px[i]<e) px[i]=e; else if (px[i]>W) px[i]=W;
      if (py[i]<e) py[i]=e; else if (py[i]>H) py[i]=H;
    }
  }

  postProcess(dt){
    const n=this.n, x=this.x, y=this.y, vx=this.vx, vy=this.vy;
    const h=this.h, h2=this.h2, P6=this.POLY6, SP=this.SPIKY;
    const mass=this.mass, rho=this.rho, rest=this.rest, nbr=this.nbr, nc=this.nc, MAXN=this.MAXN;
    const om=this.om, ax=this.ax, ay=this.ay, bf=this.bf;
    const visc=this.viscosity, coh=this.cohesion, vor=this.vorticity, tp=this.type;
    const adh=this.adhesion;
    const h4=h*h*h*h;

    if (vor>0){
      for (let i=0;i<n;i++){
        const xi=x[i], yi=y[i], ux=vx[i], uy=vy[i];
        const base=i*MAXN, cnt=nc[i];
        let w=0;
        for (let k=0;k<cnt;k++){
          const j=nbr[base+k];
          const dx=xi-x[j], dy=yi-y[j];
          const r2=dx*dx+dy*dy;
          if (r2>=h2||r2<1e-14) continue;
          const rr=Math.sqrt(r2);
          const c=SP*(h-rr)*(h-rr)/rr*(mass[j]/rho[j]);
          w += (vx[j]-ux)*(c*dy) - (vy[j]-uy)*(c*dx);
        }
        om[i]=w;
      }
    }
    const COH=this.COH;
    for (let i=0;i<n;i++){
      const xi=x[i], yi=y[i], ux=vx[i], uy=vy[i], ti=tp[i];
      const base=i*MAXN, cnt=nc[i];
      let sx=0, sy=0, hx=0, hy=0, ex=0, ey=0;
      let smw=P6*h2*h2*h2*mass[i], sw=P6*h2*h2*h2;   // своя частица тоже в среде
      for (let k=0;k<cnt;k++){
        const j=nbr[base+k];
        const dx=xi-x[j], dy=yi-y[j];
        const r2=dx*dx+dy*dy;
        if (r2>=h2||r2<1e-14) continue;
        const t=h2-r2, w=P6*t*t*t, vol=mass[j]/rho[j];
        smw += mass[j]*w; sw += w;
        sx+=(vx[j]-ux)*w*vol; sy+=(vy[j]-uy)*w*vol;
        if (coh===0 && vor===0) continue;
        const rr=Math.sqrt(r2);
        if (coh>0 && tp[j]===ti){
          // Парная сила когезии (Becker & Teschner 2007; сплайн из Akinci 2013).
          // K_ij = 2ρ₀/(ρ_i+ρ_j) — симметризация: без неё на границе фаз сила
          // перекошена в сторону более плотной частицы.
          const Kij = 2*rest[i]/(rho[i]+rho[j]);
          const Cc = Kij*cohSpline(rr,h,COH)*(mass[j]/rest[i])/rr;
          hx -= Cc*dx; hy -= Cc*dy;
        }
        if (vor>0){
          const c=SP*(h-rr)*(h-rr)/rr*vol*Math.abs(om[j]);
          ex+=c*dx; ey+=c*dy;
        }
      }
      // Архимед. Ограничение плотности работает по упаковке и к массе слепо —
      // само по себе оно фазы не сортирует. Локальную плотность среды берём
      // с нормировкой Шепарда (Σm·W)/(Σ V·W), поэтому у свободной поверхности
      // и у стенок, где соседей не хватает, сила честно обращается в ноль.
      // Натяжение — это СИЛА, а не поправка к скорости. Раньше она вносилась
      // здесь, уже ПОСЛЕ проекции давления: решатель гасил её на следующем же
      // шаге, и ползунок когезии ни на что не влиял. Теперь она копится, как
      // и Архимед, и прикладывается в предсказании — тогда давление отвечает
      // на неё в том же шаге, а не борется с ней.
      let stx=coh*hx, sty=coh*hy;
      // Смачивание: стенка притягивает жидкость. Контактный угол задаётся
      // отношением прилипания к когезии — ровно как в жизни. При adh=0 стенка
      // несмачиваемая, и урез у борта проседает; при adh≈коэффициенту когезии
      // получается почти плоский мениск.
      const sbi=this.bs[i];
      if (adh>0 && sbi<h){
        const a=adh*adhSpline(sbi,h);
        stx -= a*this.bnx[i]; sty -= a*this.bny[i];
      }
      this.stx[i]=stx; this.sty[i]=sty;
      let dvx=visc*sx, dvy=visc*sy;
      // Коэффициент запоминаем: силу приложим в предсказании, рядом с
      // гравитацией. Если добавить её здесь, после проекции, решатель
      // погасит набранную скорость на следующем же шаге и всплытие
      // растянется на десятки секунд.
      bf[i] = sw>1e-9 ? (rest[i]-smw*this.rhoUnit/sw)/rest[i] : 0;
      if (vor>0){
        const l=Math.hypot(ex,ey);
        if (l>1e-9){ const w=om[i]*vor*dt; dvx+=(ey/l)*w; dvy+=-(ex/l)*w; }
      }
      ax[i]=dvx; ay[i]=dvy;
    }
    for (let i=0;i<n;i++){ vx[i]+=ax[i]; vy[i]+=ay[i]; }
  }

  contactFriction(){
    if (!this.useFriction) return;
    const n=this.n, vx=this.vx, vy=this.vy, flag=this.flag;
    const cnx=this.cnx, cny=this.cny, cvx=this.cvx, cvy=this.cvy;
    const f=1-this.friction;
    for (let i=0;i<n;i++){
      if (!flag[i]) continue;
      const nx=cnx[i], ny=cny[i];
      let rx=vx[i]-cvx[i], ry=vy[i]-cvy[i];
      const vn=rx*nx+ry*ny;
      const tx=(rx-vn*nx)*f, ty=(ry-vn*ny)*f;
      const n2=vn>0?vn*this.restitution:0;
      vx[i]=cvx[i]+tx+n2*nx; vy[i]=cvy[i]+ty+n2*ny;
    }
  }

  substep(dt){
    const n=this.n, x=this.x, y=this.y, vx=this.vx, vy=this.vy, px=this.px, py=this.py;
    const gx=this.gx, gy=this.gy, vmax=this.h/dt;
    const bf=this.bf;
    const stx=this.stx, sty=this.sty;
    for (let i=0;i<n;i++){
      const b=1+bf[i]*this.archimedes;
      let ux=vx[i]+(gx*b+stx[i])*dt, uy=vy[i]+(gy*b+sty[i])*dt;
      const s2=ux*ux+uy*uy;
      if (this.clampV && s2>vmax*vmax){ const k=vmax/Math.sqrt(s2); ux*=k; uy*=k; }
      vx[i]=ux; vy[i]=uy;
      px[i]=x[i]+ux*dt; py[i]=y[i]+uy*dt;
    }
    this.clampWorld();
    this.buildGrid();
    this.buildNeighbors();
    for (let it=0;it<this.iters;it++){
      this.sampleBoundary();
      this.computeLambda();
      this.applyDeltaP();
      this.smoothFilm();
      this.solveColliders();
    }
    const inv=1/dt;
    for (let i=0;i<n;i++){
      vx[i]=(px[i]-x[i])*inv; vy[i]=(py[i]-y[i])*inv;
      x[i]=px[i]; y[i]=py[i];
    }
  }

  step(dt, substeps){
    this.updateBounds();
    // Ниже 2×2 решатель не успевает погасить сжатие: замерено 25–68 % против
    // 5–13 % при 2×2 и выше. Держим границу в ядре, а не только в ползунках.
    substeps = substeps >= 2 ? (substeps|0) : 2;
    // И второй, более коварный предел. В PBF давление за одну итерацию
    // проходит ровно один слой частиц, поэтому нужное число подшагов растёт
    // обратно пропорционально шагу: столб той же глубины — это вдвое больше
    // слоёв. При 26 мм хватает трёх, при 13 мм на трёх жидкость не успевает
    // прийти в равновесие и кипит без остановки (замерено ⟨v²⟩ 5.6e-2 против
    // 1.8e-6 на пяти). Держим порог в ядре: ползунок не должен уметь
    // настраивать сцену в вечное бурление.
    const need = Math.ceil(dt/(0.31*this.spacing));
    if (need > substeps) substeps = need > 12 ? 12 : need;
    this.lastSubsteps = substeps;
    this.iters = this.iters >= 2 ? (this.iters|0) : 2;
    const sd=dt/substeps;
    for (let s=0;s<substeps;s++) this.substep(sd);
    this.postProcess(dt);
    this.contactFriction();
  }

  densityError(){
    const n=this.n; if (!n) return 0;
    let s=0;
    for (let i=0;i<n;i++){ const c=this.rho[i]/this.rest[i]-1; if (c>0) s+=c; }
    return s/n;
  }
  avgNeighbors(){
    const n=this.n; if (!n) return 0;
    let s=0; for (let i=0;i<n;i++) s+=this.nc[i];
    return s/n;
  }
  kineticEnergy(){
    const n=this.n; if (!n) return 0;
    let e=0; for (let i=0;i<n;i++) e+=this.vx[i]*this.vx[i]+this.vy[i]*this.vy[i];
    return e/n;
  }
}

/* =========================================================================
   render/metaballs.js — скалярное поле → marching squares → SVG path

   Три правила, из которых следует всё остальное:
   · шаг сетки поля ДОЛЖЕН быть мельче расстояния между частицами,
     иначе слой толщиной в одну частицу невозможно изобразить;
   · радиус размазывания держим меньше самой тонкой стенки — тогда поле
     не просачивается сквозь неё и маска твёрдых тел не нужна;
   · тела рисуются ПОВЕРХ воды, поэтому контур можно спокойно заводить
     внутрь стенки — берег получается плоским, а не скруглённым.
   ========================================================================= */
class SurfaceMesher {
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
    const bs=sim.bs, cols=sim.colliders, nrm=[0,0];
    const useGhosts = !!(bs && cols);
    // Зеркало имеет смысл, только если оно попало В ТВЁРДОЕ ТЕЛО. Если стенка
    // (или перемычка песка) тоньше глубины отражения, призрак вылезает наружу
    // и рисует воду по ту сторону преграды.
    const tolG = cs*0.5;
    const inSolid=(gx,gy)=>{
      for (let c=0;c<cols.length;c++){
        const sh=cols[c];
        if (sh.skip) continue;
        if (sdf(sh,gx,gy) <= tolG) return true;
      }
      return false;
    };
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
      if (!useGhosts || bs[i]>=R) continue;
      let n1x=0,n1y=0,d1=0, n2x=0,n2y=0,d2=0, found=0;
      const addGhost=(s,gnx,gny)=>{
        const gx=xi-2*s*gnx, gy=yi-2*s*gny;
        if (inSolid(gx,gy)) splatAt(gx,gy);
        if (found===0){ n1x=gnx; n1y=gny; d1=s; found=1; }
        else if (found===1){ n2x=gnx; n2y=gny; d2=s; found=2; }
      };
      for (let c=0;c<cols.length;c++){
        const sh=cols[c];
        if (sh.skip) continue;
        if (sh.k==='room'){
          // Комната — ОДНО тело, но четыре стены. Если брать её общий SDF,
          // в углу выйдет одно зеркало с диагональной нормалью, и угол
          // останется пустым. Поэтому отражаем от каждой грани отдельно —
          // тогда угловое отражение получается само.
          const L=sh.x-sh.hw, Rr=sh.x+sh.hw, T=sh.y-sh.hh, B=sh.y+sh.hh;
          if (xi-L < R) addGhost(Math.max(0,xi-L), -1, 0);
          if (Rr-xi < R) addGhost(Math.max(0,Rr-xi),  1, 0);
          if (yi-T < R) addGhost(Math.max(0,yi-T),  0,-1);
          if (B-yi < R) addGhost(Math.max(0,B-yi),  0, 1);
          continue;
        }
        if (xi<sh._x0||xi>sh._x1||yi<sh._y0||yi>sh._y1) continue;
        const dd=sdf(sh, xi, yi);
        if (dd>=R) continue;
        sdfGrad(sh, xi, yi, nrm);
        addGhost(dd>0?dd:0, nrm[0], nrm[1]);
      }
      // Угол: отражение сразу от обеих стенок — но только если это ДЕЙСТВИТЕЛЬНО
      // угол. Когда нормали сонаправлены (грунт лежит на дне таза, стенка
      // стыкуется с заслонкой), двойное отражение уносит призрака на 2(d1+d2)
      // вглубь: он пробивает тело насквозь и рисует воду с обратной стороны.
      if (found===2 && (n1x*n2x+n1y*n2y) < 0.3){
        const gx=xi-2*d1*n1x-2*d2*n2x, gy=yi-2*d1*n1y-2*d2*n2y;
        if (inSolid(gx,gy)) splatAt(gx,gy);
      }
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
      out+='M'+(Math.round(src[0]*10)/10)+' '+(Math.round(src[1]*10)/10);
      for (let i=1;i<m;i++) out+='L'+(Math.round(src[i*2]*10)/10)+' '+(Math.round(src[i*2+1]*10)/10);
      out+='Z';
      verts+=m;
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
function bulkFieldValue(R, d){ return Math.PI*R*R/(3*0.8660254*d*d); }

export { FluidSolver, SurfaceMesher, bulkFieldValue, makeKernels, calibrate };