import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import '../../entities/index.js'
import { createLevel } from '../../core/Level.js'
import LevelEditor from '../LevelEditor.vue'
import { firePointer } from '../../test/dom-events.js'

let wrapper
afterEach(() => {
  wrapper?.unmount()
})

function mountEditor(level = createLevel()) {
  wrapper = mount(LevelEditor, { props: { level }, attachTo: document.body })
  return { level, wrapper }
}

describe('LevelEditor.vue: toolbar', () => {
  it('renders exactly one button per registered entity definition', () => {
    const { wrapper } = mountEditor()
    expect(wrapper.findAll('.tool-btn')).toHaveLength(3) // rock, ball, pipe
  })

  it('arms an entity type on click and shows the placement hint', async () => {
    const { wrapper } = mountEditor()
    const rockBtn = wrapper.findAll('.tool-btn')[0]
    await rockBtn.trigger('click')
    expect(rockBtn.classes()).toContain('armed')
    expect(wrapper.find('.hint').exists()).toBe(true)
  })

  it('disarms when the same button is clicked again', async () => {
    const { wrapper } = mountEditor()
    const rockBtn = wrapper.findAll('.tool-btn')[0]
    await rockBtn.trigger('click')
    await rockBtn.trigger('click')
    expect(rockBtn.classes()).not.toContain('armed')
    expect(wrapper.find('.hint').exists()).toBe(false)
  })
})

describe('LevelEditor.vue: placing entities', () => {
  it('places a new instance on canvas click while armed, and switches into its context', async () => {
    const { level, wrapper } = mountEditor()
    await wrapper.findAll('.tool-btn')[1].trigger('click') // ball
    await firePointer(wrapper.find('svg'), 'pointerdown', { clientX: 300, clientY: 200 })
    expect(level.state.entities).toHaveLength(1)
    expect(level.state.entities[0].type).toBe('ball')
    expect(level.state.entities[0].points[0].x).toBe(300)
    // теперь мы в контексте свежесозданной сущности — должна появиться панель свойств
    expect(wrapper.find('.properties').exists()).toBe(true)
  })

  it('disarms after a single placement (does not stamp repeatedly)', async () => {
    const { wrapper } = mountEditor()
    await wrapper.findAll('.tool-btn')[0].trigger('click') // rock
    await firePointer(wrapper.find('svg'), 'pointerdown', { clientX: 100, clientY: 100 })
    expect(wrapper.findAll('.tool-btn')[0].classes()).not.toContain('armed')
  })
})

describe('LevelEditor.vue: selection & context', () => {
  it('clicking empty canvas without moving clears context and selection', async () => {
    const { wrapper } = mountEditor()
    const svg = wrapper.find('svg')
    await firePointer(svg, 'pointerdown', { clientX: 400, clientY: 400 })
    await firePointer(svg, 'pointerup', { clientX: 400, clientY: 400 })
    expect(wrapper.find('.properties').exists()).toBe(false)
  })

  it('selecting an entity (via its EditorComponent "select" emit) enters its context and shows its properties panel', async () => {
    const level = createLevel()
    level.addEntity('rock', { x: 100, y: 100 })
    const { wrapper } = mountEditor(level)
    // LevelEditor wraps each entity in its own <g>; RockEditor's interactive <g> is the inner one
    await wrapper.findAll('g')[1].trigger('pointerdown')
    expect(wrapper.find('.properties').exists()).toBe(true)
    expect(wrapper.find('.properties h3').text()).toContain('Порода')
  })

  it('dragging a rectangle in the zero context selects overlapping entities', async () => {
    const level = createLevel()
    level.addEntity('ball', { x: 50, y: 50, radius: 10 })
    level.addEntity('ball', { x: 800, y: 500, radius: 10 })
    const { wrapper } = mountEditor(level)
    const svg = wrapper.find('svg')
    await firePointer(svg, 'pointerdown', { clientX: 0, clientY: 0 })
    await firePointer(svg, 'pointermove', { clientX: 100, clientY: 100 })
    await firePointer(svg, 'pointerup', { clientX: 100, clientY: 100 })
    expect(wrapper.findAll('.sel-ring')).toHaveLength(1)
  })
})

describe('LevelEditor.vue: Del key', () => {
  it('removes all selected entities in the zero context', async () => {
    const level = createLevel()
    level.addEntity('ball', { x: 50, y: 50, radius: 10 })
    const { wrapper } = mountEditor(level)
    const svg = wrapper.find('svg')
    await firePointer(svg, 'pointerdown', { clientX: 0, clientY: 0 })
    await firePointer(svg, 'pointermove', { clientX: 100, clientY: 100 })
    await firePointer(svg, 'pointerup', { clientX: 100, clientY: 100 })
    expect(level.state.entities).toHaveLength(1)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    await wrapper.vm.$nextTick()
    expect(level.state.entities).toHaveLength(0)
  })

  it('deletes only the selected vertex when a rock is in context with a sub-selection, keeping the entity', async () => {
    const level = createLevel()
    const rock = level.addEntity('rock', {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    })
    const { wrapper } = mountEditor(level)
    await wrapper.findAll('g')[1].trigger('pointerdown') // войти в контекст rock (внутренний <g> RockEditor)
    // выделяем рамкой первую вершину (0,0)
    const svg = wrapper.find('svg')
    await firePointer(svg, 'pointerdown', { clientX: -5, clientY: -5 })
    await firePointer(svg, 'pointermove', { clientX: 5, clientY: 5 })
    await firePointer(svg, 'pointerup', { clientX: 5, clientY: 5 })
    expect(rock.state._selectedVertices).toEqual([0])

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    await wrapper.vm.$nextTick()

    expect(level.state.entities).toHaveLength(1) // сущность цела
    expect(rock.state.points).toHaveLength(3) // но вершина удалена
  })

  it('deletes the whole entity when in its context without a sub-selection (default fallback)', async () => {
    const level = createLevel()
    level.addEntity('ball', { x: 100, y: 100 })
    const { wrapper } = mountEditor(level)
    await wrapper.find('circle').trigger('pointerdown') // войти в контекст шара (BallEditor emits select)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    await wrapper.vm.$nextTick()
    expect(level.state.entities).toHaveLength(0)
  })

  it('ignores keys other than Delete/Backspace', async () => {
    const level = createLevel()
    level.addEntity('ball', { x: 100, y: 100 })
    const { wrapper } = mountEditor(level)
    await wrapper.find('circle').trigger('pointerdown')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    await wrapper.vm.$nextTick()
    expect(level.state.entities).toHaveLength(1)
  })
})

describe('LevelEditor.vue: dragging entity parts', () => {
  it('dragging a rock vertex handle moves that vertex and keeps collisionShape in sync', async () => {
    const level = createLevel()
    const rock = level.addEntity('rock', {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    })
    const { wrapper } = mountEditor(level)
    await wrapper.findAll('g')[1].trigger('pointerdown') // войти в контекст rock
    const handle = wrapper.findAll('circle')[0] // хэндл вершины 0 (0,0)
    await handle.trigger('pointerdown')
    const svg = wrapper.find('svg')
    await firePointer(svg, 'pointermove', { clientX: 42, clientY: 24 })
    expect(rock.state.points[0]).toEqual({ x: 42, y: 24 })
    expect(rock.collisionShape.points[0]).toEqual({ x: 42, y: 24 })
    await firePointer(svg, 'pointerup')
  })

  it('dragging a pipe endpoint handle moves that endpoint', async () => {
    const level = createLevel()
    const pipe = level.addEntity('pipe', { from: { x: 0, y: 0 }, to: { x: 90, y: -10 } })
    const { wrapper } = mountEditor(level)
    await wrapper.findAll('g')[1].trigger('pointerdown') // войти в контекст трубы
    const handles = wrapper.findAll('circle')
    await handles[1].trigger('pointerdown') // "to" endpoint
    const svg = wrapper.find('svg')
    await firePointer(svg, 'pointermove', { clientX: 500, clientY: 60 })
    expect(pipe.state.to).toEqual({ x: 500, y: 60 })
    expect(pipe.state.from).toEqual({ x: 0, y: 0 }) // другой конец не тронут
    await firePointer(svg, 'pointerup')
  })
})

describe('LevelEditor.vue: bonding via entity-context click', () => {
  it('clicking a second bondable ball while in a ball context creates a connection instead of switching context', async () => {
    const level = createLevel()
    const a = level.addEntity('ball', { x: 100, y: 100 })
    const b = level.addEntity('ball', { x: 300, y: 100 })
    const { wrapper } = mountEditor(level)
    const circles = wrapper.findAll('circle')
    await circles[0].trigger('pointerdown') // выбрать шар A -> контекст A
    await circles[1].trigger('pointerdown') // клик по шару B -> должно создать связь, а не сменить контекст
    expect(level.connectionExists(a.id, b.id)).toBe(true)
  })
})
