// Общее для двух стендов: один уровень, одни коэффициенты, один формат отчёта.
//
// Всё в ПИКСЕЛЯХ. Исходник считает в метрах при 250 px/м, поэтому у него мир
// задаётся как 1600/250 × 900/250, шаг частиц 11/250, тяжесть 1800/250. Так
// геометрия и динамика совпадают до числа, а сравнивать можно напрямую.

export const PX = 250            // пикселей в метре — масштаб исходника

export const BENCH = {
  version: 1,
  W: 1600, H: 900,               // размер уровня, px
  wall: 60,                      // толщина породы по периметру, px
  grain: 11,                     // шаг частиц, px
  particles: 4500,
  gravity: 1800,                 // px/с²

  // Песчаная плита ЛЕЖИТ НА ПОЛУ: пол начинается с H-wall = 840.
  sand: { x: 400, y: 750, w: 800, h: 90 },

  // Область налива. Высоту считаем, а не подбираем: 4500 частиц гексагональной
  // укладки занимают 4500·d·(d·√3/2) ≈ 471 тыс. px², плюс объём песчаной плиты,
  // который вода занять не может. Тогда вода сразу стоит на дне, а не падает —
  // иначе первые секунды стенд мерит всплеск налива, а не жидкость.
  water: { x: 62, y: 470, w: 1476, h: 370 },

  // Коэффициенты решателя. Слева — как их зовёт исходник.
  // Когезия и смачивание заданы в ДОЛЯХ ТЯЖЕСТИ: иначе при разной гравитации
  // вещество меняет характер, и стенды сравнивать нельзя.
  solver: {
    viscosity: 0.05,
    cohesionG: 3.06,             // исходник: cohesion м/с² = cohesionG * g
    adhesionG: 1.02,             // исходник: adhesion
    film: 0.5,
    tension: 0.03,               // искусственное давление (s_corr)
    tensile: 0.05,
    rest0: 1000,
    vorticity: 0.12,
    friction: 0.10,
    iters: 2,
    substeps: 3,
    omega: 0.8,
    relax: 0.5,
    surfLevel: 0.5,
    iso: 0.45,
    blob: 1.8,
    smooth: 2,
  },

  dt: 1 / 60,
  warmup: 240,                   // кадров на осадку до замера
  frames: 1200,                  // 20 с замера
  sampleEvery: 30,               // раз в полсекунды снимаем поведение
}

// Уровень для движка: порода по периметру, песчаная плита, вода.
export function buildLevelWob() {
  const B = BENCH, w = B.wall
  const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  // Периметр — четыре стены. Пробовал одним телом с дыркой: вода вытекала,
  // разбираться с ориентацией контуров тут не место. В исходнике стены тоже
  // четыре, геометрия совпадает — а как её представлять, каждый движок решает
  // сам, и это часть того, что мы сравниваем.
  const rock = (id, x0, y0, x1, y1) => ({
    id, type: 'terrain',
    data: { points: box(x0, y0, x1, y1), smoothness: 0.35, fill: '#2a3326', edge: '#66804f' },
  })
  return {
    width: B.W, height: B.H, gravity: { x: 0, y: B.gravity },
    entities: [
      rock('rock-top', 0, 0, B.W, w),
      rock('rock-bottom', 0, B.H - w, B.W, B.H),
      rock('rock-left', 0, w, w, B.H - w),
      rock('rock-right', B.W - w, w, B.W, B.H - w),
      {
        id: 'sand', type: 'sand',
        data: {
          points: box(B.sand.x, B.sand.y, B.sand.x + B.sand.w, B.sand.y + B.sand.h),
          polys: null, dig: 14, smoothness: 0.25, fill: '#c9a86a', edge: '#8a6f3e',
        },
      },
      {
        id: 'water', type: 'liquid',
        data: {
          points: box(B.water.x, B.water.y, B.water.x + B.water.w, B.water.y + B.water.h),
          polys: null, substance: 'water',
          density: 1, viscosity: B.solver.viscosity, tension: B.solver.cohesionG,
          grain: B.grain, limit: B.particles,
        },
      },
    ],
  }
}

// Накопитель отчёта. Один формат для обоих стендов, чтобы их можно было
// положить рядом и сравнить построчно.
export class Recorder {
  constructor(build, bench) {
    this.build = build
    this.bench = bench
    this.reset()
  }

  reset() {
    this.frames = []        // мс на кадр: [физика, отрисовка]
    this.samples = []       // поведение раз в полсекунды
    this.t0 = performance.now()
  }

  // Возвращает true, когда замер закончен.
  tick(tPhys, tDraw, sampleFn) {
    this.frames.push([+tPhys.toFixed(3), +tDraw.toFixed(3)])
    if (this.frames.length % this.bench.sampleEvery === 0) {
      const s = sampleFn()
      this.samples.push({
        frame: this.frames.length,
        t: +(this.frames.length * this.bench.dt).toFixed(2),
        n: s.n,
        vRms: +s.vRms.toFixed(2),
        vMax: +s.vMax.toFixed(1),
        yMean: +s.yMean.toFixed(1),
        yTop: +s.yTop.toFixed(1),
        flat: +s.flat.toFixed(2),
      })
    }
    return this.frames.length >= this.bench.frames
  }

  stats() {
    const phys = this.frames.map((f) => f[0]).sort((a, b) => a - b)
    const draw = this.frames.map((f) => f[1]).sort((a, b) => a - b)
    const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0)
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
    return {
      frames: this.frames.length,
      physMean: +mean(phys).toFixed(2), physMed: +q(phys, 0.5).toFixed(2), physP95: +q(phys, 0.95).toFixed(2),
      drawMean: +mean(draw).toFixed(2), drawMed: +q(draw, 0.5).toFixed(2), drawP95: +q(draw, 0.95).toFixed(2),
      totalMean: +(mean(phys) + mean(draw)).toFixed(2),
      fps: +(1000 / (mean(phys) + mean(draw))).toFixed(1),
    }
  }

  report() {
    return {
      format: 'wob-bench',
      version: this.bench.version,
      build: this.build,
      when: new Date().toISOString(),
      agent: typeof navigator === 'undefined' ? 'node' : navigator.userAgent,
      bench: this.bench,
      perf: this.stats(),
      behaviour: this.samples,
      framesMs: this.frames,
    }
  }

  download() {
    const blob = new Blob([JSON.stringify(this.report(), null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `bench-${this.build}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
}
