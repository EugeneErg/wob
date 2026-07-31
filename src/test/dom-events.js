// test/dom-events.js
import { nextTick } from 'vue'

export async function firePointer(wrapperOrElement, type, { clientX = 0, clientY = 0 } = {}) {
  const el = wrapperOrElement.element ?? wrapperOrElement
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  await nextTick()
}
