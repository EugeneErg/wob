// Ядра SPH в 2D, сплайны Akinci и калибровка по гексагональной решётке.
//
// Перенесено дословно из эталонной реализации PBF: формулы, нормировки и
// сплайны здесь не «примерно те же», а буквально те же. Любая правка
// коэффициента меняет поведение всей жидкости, поэтому файл нельзя трогать,
// не перемерив заново то, на чём калибровались параметры веществ.

export function makeKernels(h){
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
export function cohSpline(r, h, A){
  if (r<=0 || r>=h) return 0;
  const a=h-r, t=a*a*a*r*r*r;
  return A*(2*r>h ? t : 2*t - h*h*h*h*h*h/64);
}

/* Сплайн прилипания к стенке (Akinci 2013, §4). Ноль при r=h и при r=h/2,
   максимум посередине: далёкая частица стенку не чувствует, а прижатая
   вплотную не получает бесконечной тяги. Нормирован на единицу в максимуме,
   поэтому коэффициент задаётся прямо в м/с². */
export function adhSpline(r, h){
  if (2*r<=h || r>=h) return 0;
  const v=-4*r*r/h + 6*r - 2*h;
  return v<=0 ? 0 : Math.pow(v/(0.75*h), 0.25);
}

/* Калибровка по гексагональной решётке с шагом d: даёт плотность покоя при m=1
   и типичное Σ|∇C|². Все параметры ниже становятся безразмерными. */
export function calibrate(h, d){
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

/* Таблица пополнения плотности у границы.
   f(s) — доля интеграла ядра, ушедшая за плоскую стенку на расстоянии s;
   l(s) — интеграл ядра вдоль самой стенки (это −f'(s)).            */
export function buildBoundaryTable(h, P6){
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
