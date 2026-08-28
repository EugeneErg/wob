// Детерминированный генератор случайных чисел.
//
// Обычный Math.random() ломает повтор: один и тот же тик с одним и тем же
// вводом даст разный результат при каждом проигрывании. Для спидранов и
// реплеев нужен ГСЧ, чей следующий результат зависит только от seed и от
// того, сколько раз его уже спросили — а не от времени суток.
//
// Алгоритм — mulberry32: маленький, быстрый, с хорошим распределением для
// игровых нужд (не криптографический, он тут и не нужен).

export function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Обёртка с интерфейсом, привычным по Math.random(), плюс числовыми хелперами
// того же вида, что раскиданы по entity-файлам (a + Math.random() * (b - a) и т.п.)
export class Rng {
  constructor(seed = 1) {
    this.seed = seed >>> 0
    this._next = mulberry32(this.seed)
    this.calls = 0
  }
  // 0..1, как Math.random()
  next() { this.calls++; return this._next() }
  // [min, max)
  range(min, max) { return min + this.next() * (max - min) }
  // -1 или 1
  sign() { return this.next() < 0.5 ? -1 : 1 }
  // целое [0, n)
  int(n) { return (this.next() * n) | 0 }
  // случайный элемент массива
  pick(arr) { return arr.length ? arr[this.int(arr.length)] : undefined }
  // Пересоздать поток заново с тем же seed — нужно при перемотке реплея
  // назад: детерминированный ГСЧ нельзя отмотать, только пересчитать с нуля.
  reset() { this._next = mulberry32(this.seed); this.calls = 0 }
}

// seed по умолчанию для случаев без явного запроса (например, предпросмотр
// в редакторе) — фиксированное число, а не Date.now(), чтобы даже без
// явного управления сидом поведение было воспроизводимо в рамках сессии.
export const DEFAULT_SEED = 1
