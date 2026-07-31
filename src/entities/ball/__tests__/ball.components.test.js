import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import { mount } from '@vue/test-utils'
import BallGame from '../BallGame.vue'
import BallEditor from '../BallEditor.vue'
import ball from '../index.js'

function instance(props) {
  return ball.createInstance('ball_1', props)
}

describe('BallGame.vue', () => {
  it('renders a circle at the physics point position with the instance radius/color', () => {
    const inst = instance({ x: 30, y: 40, radius: 15, color: '#ff0000' })
    const wrapper = mount(BallGame, { props: { instance: inst } })
    const circle = wrapper.find('circle')
    expect(circle.attributes('cx')).toBe('30')
    expect(circle.attributes('cy')).toBe('40')
    expect(circle.attributes('r')).toBe('15')
    expect(circle.attributes('fill')).toBe('#ff0000')
  })

  it('tracks the live physics point, not a frozen snapshot', async () => {
    const inst = reactive(instance({ x: 0, y: 0 }))
    const wrapper = mount(BallGame, { props: { instance: inst } })
    inst.points[0].x = 77
    await wrapper.vm.$nextTick()
    expect(wrapper.find('circle').attributes('cx')).toBe('77')
  })
})

describe('BallEditor.vue', () => {
  it('renders a circle and highlights it with a thicker stroke when active', () => {
    const inst = instance({ x: 0, y: 0 })
    const activeWrapper = mount(BallEditor, { props: { instance: inst, active: true } })
    const inactiveWrapper = mount(BallEditor, { props: { instance: inst, active: false } })
    expect(activeWrapper.find('circle').attributes('stroke')).toBe('#ffd166')
    expect(inactiveWrapper.find('circle').attributes('stroke')).toBe('#222')
  })

  it('emits "select" with the instance id on pointerdown', async () => {
    const inst = instance({ x: 0, y: 0 })
    const wrapper = mount(BallEditor, { props: { instance: inst, active: false } })
    await wrapper.find('circle').trigger('pointerdown')
    expect(wrapper.emitted('select')).toEqual([[inst.id]])
  })
})
