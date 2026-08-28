// Дорожка камеры.
//
// Камеру приходится записывать отдельно, и это не прихоть. Восстановить её
// из записи ввода нельзя: прокрутка включается, когда курсор подходит к краю
// ЭКРАНА (edgePush считает долю от clientX и размера окна), а в записи лежат
// мировые координаты. На другом размере окна тот же мировой курсор окажется
// на другом расстоянии от края, и камера поедет иначе.
//
// Почему это отдельная дорожка, а не события ввода. Камера не влияет на
// симуляцию — мир не знает, куда смотрит игрок. Если смешать её со вводом,
// то повреждённая или отредактированная дорожка камеры сможет изменить
// результат прогона, а этого быть не должно: проверяющий обязан получить то
// же время, вообще выбросив камеру. Поэтому она лежит рядом и на воспроизведение
// мира не влияет никак — только на то, что видит зритель.
//
// Хранится разреженно: ключевые кадры пишутся, только когда камера
// действительно сдвинулась. У неподвижной камеры дорожка — одна запись.

const Q = 10                    // десятая доля пикселя мира: мельче глаз не видит
const q = (v) => Math.round(v * Q) / Q
const MOVED = 0.5               // сдвиг меньше этого не считаем за движение

export class CameraTrack {
  constructor(keys = []) {
    this.keys = keys              // подряд: tick, x, y, w, h, tick, x, ...
    this._cursor = 0
    this._last = null
  }

  get length() { return this.keys.length / 5 }

  // --- запись ---------------------------------------------------------------
  record(tick, cam) {
    const x = q(cam.x), y = q(cam.y), w = q(cam.w), h = q(cam.h)
    const p = this._last
    if (p && Math.abs(p.x - x) < MOVED && Math.abs(p.y - y) < MOVED && p.w === w && p.h === h) return
    this.keys.push(tick, x, y, w, h)
    this._last = { x, y, w, h }
  }

  // --- воспроизведение ------------------------------------------------------
  // Положение камеры на данном тике. Между ключевыми кадрами — линейно:
  // прокрутка у нас плавная, и без сглаживания повтор дёргался бы на каждом
  // пропущенном кадре.
  at(tick) {
    const k = this.keys
    if (!k.length) return null
    while (this._cursor + 5 < k.length && k[this._cursor + 5] <= tick) this._cursor += 5
    const i = this._cursor
    const cur = { tick: k[i], x: k[i + 1], y: k[i + 2], w: k[i + 3], h: k[i + 4] }
    const j = i + 5
    if (j >= k.length) return cur
    const nxt = { tick: k[j], x: k[j + 1], y: k[j + 2], w: k[j + 3], h: k[j + 4] }
    const span = nxt.tick - cur.tick
    if (span <= 0) return nxt
    const t = Math.max(0, Math.min(1, (tick - cur.tick) / span))
    return {
      x: cur.x + (nxt.x - cur.x) * t,
      y: cur.y + (nxt.y - cur.y) * t,
      w: cur.w + (nxt.w - cur.w) * t,
      h: cur.h + (nxt.h - cur.h) * t,
    }
  }

  rewind() { this._cursor = 0 }
  toJSON() { return this.keys }
  static from(keys) { return new CameraTrack(Array.isArray(keys) ? keys.slice() : []) }
}
