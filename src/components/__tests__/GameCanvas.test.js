import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import '../../entities/index.js' // регистрирует rock/ball/pipe для этого тестового файла
import { createLevel } from '../../core/Level.js'
import GameCanvas from '../GameCanvas.vue'
import { firePointer } from '../../test/dom-events.js'

let wrapper
afterEach(() => {
  wrapper?.unmount() // останавливает requestAnimationFrame-цикл физики между тестами
})

describe('GameCanvas.vue', () => {
  it('renders one game-component instance per level entity', () => {
    const level = createLevel()
    level.addEntity('rock', { x: 100, y: 100 })
    level.addEntity('ball', { x: 50, y: 50 })
    wrapper = mount(GameCanvas, { props: { level } })
    expect(wrapper.findAll('polygon')).toHaveLength(1)
    expect(wrapper.findAll('circle')).toHaveLength(1)
  })

  it('draws higher z-index entities after lower ones (balls painted over rock)', () => {
    const level = createLevel()
    level.addEntity('rock', { x: 100, y: 100 }) // zIndex 0
    level.addEntity('ball', { x: 50, y: 50 }) // zIndex 10
    wrapper = mount(GameCanvas, { props: { level } })
    const svgHtml = wrapper.find('svg').element.innerHTML
    expect(svgHtml.indexOf('<polygon')).toBeLessThan(svgHtml.indexOf('<circle'))
  })

  it('renders a connection line between two bonded balls using their live point positions', () => {
    const level = createLevel()
    const a = level.addEntity('ball', { x: 10, y: 20 })
    const b = level.addEntity('ball', { x: 200, y: 220 })
    level.toggleConnection(a.id, b.id)
    wrapper = mount(GameCanvas, { props: { level } })
    const lines = wrapper.findAll('line')
    expect(lines).toHaveLength(1)
    expect(lines[0].attributes('x1')).toBe(String(a.points[0].x))
    expect(lines[0].attributes('y1')).toBe(String(a.points[0].y))
  })

  it('renders no entities for an empty level without erroring', () => {
    const level = createLevel()
    wrapper = mount(GameCanvas, { props: { level } })
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.findAll('circle')).toHaveLength(0)
  })

  it('lets the player grab a ball near its point and drag it to a new position', async () => {
    const level = createLevel()
    const ball = level.addEntity('ball', { x: 100, y: 100, radius: 20 })
    wrapper = mount(GameCanvas, { props: { level } })
    const svg = wrapper.find('svg')
    await firePointer(svg, 'pointerdown', { clientX: 100, clientY: 100 })
    await firePointer(svg, 'pointermove', { clientX: 300, clientY: 300 })
    expect(ball.points[0].x).toBe(300)
    expect(ball.points[0].y).toBe(300)
    await firePointer(svg, 'pointerup')
  })

  it('ignores clicks far from any grabbable point', async () => {
    const level = createLevel()
    const ball = level.addEntity('ball', { x: 100, y: 100, radius: 20 })
    wrapper = mount(GameCanvas, { props: { level } })
    const svg = wrapper.find('svg')
    await firePointer(svg, 'pointerdown', { clientX: 900, clientY: 900 })
    await firePointer(svg, 'pointermove', { clientX: 500, clientY: 500 })
    expect(ball.points[0].x).toBe(100)
    expect(ball.points[0].y).toBe(100)
  })

  it('releases the grabbed ball on pointerup so it resumes falling under gravity', async () => {
    const level = createLevel()
    const ball = level.addEntity('ball', { x: 100, y: 100, radius: 20 })
    wrapper = mount(GameCanvas, { props: { level } })
    const svg = wrapper.find('svg')
    await firePointer(svg, 'pointerdown', { clientX: 100, clientY: 100 })
    await firePointer(svg, 'pointerup')
    await firePointer(svg, 'pointermove', { clientX: 400, clientY: 400 })
    expect(ball.points[0].x).toBe(100) // движение мыши после отпускания больше не двигает шар
  })
})
