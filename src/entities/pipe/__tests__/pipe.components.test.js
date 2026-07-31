import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PipeGame from '../PipeGame.vue'
import PipeEditor from '../PipeEditor.vue'
import pipe from '../index.js'

function instance(props) {
  return pipe.createInstance('pipe_1', props)
}

describe('PipeGame.vue', () => {
  it('renders a line between "from" and "to"', () => {
    const inst = instance({ from: { x: 1, y: 2 }, to: { x: 3, y: 4 } })
    const wrapper = mount(PipeGame, { props: { instance: inst } })
    const line = wrapper.find('line')
    expect(line.attributes('x1')).toBe('1')
    expect(line.attributes('y1')).toBe('2')
    expect(line.attributes('x2')).toBe('3')
    expect(line.attributes('y2')).toBe('4')
  })

  it('draws a mouth marker circle at "from"', () => {
    const inst = instance({ from: { x: 5, y: 6 }, to: { x: 9, y: 9 } })
    const wrapper = mount(PipeGame, { props: { instance: inst } })
    const circle = wrapper.find('circle')
    expect(circle.attributes('cx')).toBe('5')
    expect(circle.attributes('cy')).toBe('6')
  })
})

describe('PipeEditor.vue', () => {
  it('does not render endpoint handles when inactive', () => {
    const inst = instance({ x: 0, y: 0 })
    const wrapper = mount(PipeEditor, { props: { instance: inst, active: false } })
    expect(wrapper.findAll('circle')).toHaveLength(0)
  })

  it('renders exactly two endpoint handles when active', () => {
    const inst = instance({ x: 0, y: 0 })
    const wrapper = mount(PipeEditor, { props: { instance: inst, active: true } })
    expect(wrapper.findAll('circle')).toHaveLength(2)
  })

  it('emits "select" with the instance id on pointerdown', async () => {
    const inst = instance({ x: 0, y: 0 })
    const wrapper = mount(PipeEditor, { props: { instance: inst, active: false } })
    await wrapper.find('g').trigger('pointerdown')
    expect(wrapper.emitted('select')).toEqual([[inst.id]])
  })

  it('emits "endpoint-drag" identifying which endpoint was grabbed', async () => {
    const inst = instance({ x: 0, y: 0 })
    const wrapper = mount(PipeEditor, { props: { instance: inst, active: true } })
    const circles = wrapper.findAll('circle')
    await circles[0].trigger('pointerdown')
    await circles[1].trigger('pointerdown')
    expect(wrapper.emitted('endpoint-drag')).toEqual([
      [{ instanceId: inst.id, end: 'from' }],
      [{ instanceId: inst.id, end: 'to' }],
    ])
  })
})
