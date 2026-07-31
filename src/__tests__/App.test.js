import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import '../entities/index.js' // как в main.js: сущности должны быть зарегистрированы до создания App
import App from '../App.vue'

let wrapper
afterEach(() => {
  wrapper?.unmount()
})

describe('App.vue', () => {
  it('mounts without errors and starts a small non-empty level', () => {
    wrapper = mount(App)
    expect(wrapper.exists()).toBe(true)
  })

  it('starts in editor mode', () => {
    wrapper = mount(App)
    expect(wrapper.find('.editor-layout').exists()).toBe(true)
  })

  it('switches to play mode and renders the game canvas instead of the editor', async () => {
    wrapper = mount(App)
    await wrapper.findAll('.mode-switch button')[1].trigger('click') // "Играть"
    expect(wrapper.find('.editor-layout').exists()).toBe(false)
    expect(wrapper.find('.game-canvas').exists()).toBe(true)
  })

  it('switches back to editor mode', async () => {
    wrapper = mount(App)
    await wrapper.findAll('.mode-switch button')[1].trigger('click')
    await wrapper.findAll('.mode-switch button')[0].trigger('click')
    expect(wrapper.find('.editor-layout').exists()).toBe(true)
  })
})
