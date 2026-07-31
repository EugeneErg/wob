import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RockGame from '../RockGame.vue'
import RockEditor from '../RockEditor.vue'
import rock from '../index.js'

function instance(props) {
  return rock.createInstance('rock_1', props)
}

describe('RockGame.vue', () => {
  it('renders a polygon with the instance points', () => {
    const inst = instance({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] })
    const wrapper = mount(RockGame, { props: { instance: inst } })
    const polygon = wrapper.find('polygon')
    expect(polygon.exists()).toBe(true)
    expect(polygon.attributes('points')).toBe('0,0 10,0 5,10')
  })

  it('uses the instance color as fill', () => {
    const inst = instance({ x: 0, y: 0 })
    inst.state.color = '#abcdef'
    const wrapper = mount(RockGame, { props: { instance: inst } })
    expect(wrapper.find('polygon').attributes('fill')).toBe('#abcdef')
  })
})

describe('RockEditor.vue', () => {
  it('does not render vertex handles when inactive', () => {
    const inst = instance({ x: 0, y: 0 })
    const wrapper = mount(RockEditor, { props: { instance: inst, active: false } })
    expect(wrapper.findAll('circle')).toHaveLength(0)
  })

  it('renders one handle per vertex when active', () => {
    const inst = instance({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] })
    const wrapper = mount(RockEditor, { props: { instance: inst, active: true } })
    expect(wrapper.findAll('circle')).toHaveLength(3)
  })

  it('emits "select" with the instance id when the polygon body is clicked', async () => {
    const inst = instance({ x: 0, y: 0 })
    const wrapper = mount(RockEditor, { props: { instance: inst, active: false } })
    await wrapper.find('g').trigger('pointerdown')
    expect(wrapper.emitted('select')).toEqual([[inst.id]])
  })

  it('emits "vertex-drag" with instanceId and index when a handle is grabbed', async () => {
    const inst = instance({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] })
    const wrapper = mount(RockEditor, { props: { instance: inst, active: true } })
    await wrapper.findAll('circle')[1].trigger('pointerdown')
    expect(wrapper.emitted('vertex-drag')).toEqual([[{ instanceId: inst.id, index: 1 }]])
  })
})
