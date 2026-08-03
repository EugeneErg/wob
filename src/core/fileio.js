// Сохранение и загрузка файлов истории — без внешних зависимостей

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function pickJSON() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return reject(new Error('Файл не выбран'))
      const reader = new FileReader()
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result))) } catch (e) { reject(new Error('Файл повреждён')) }
      }
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
      reader.readAsText(file)
    }
    input.click()
  })
}

export function pickImage() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return reject(new Error('Файл не выбран'))
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Не удалось прочитать картинку'))
      reader.readAsDataURL(file)
    }
    input.click()
  })
}

const slug = (s) => (s || 'goo').toLowerCase().replace(/[^\wа-яё]+/gi, '-').replace(/^-|-$/g, '')
export const fileName = (kind, title) => `${kind}-${slug(title)}`

// Обложка: либо картинка (URL или data:), либо любая css-заливка
export function coverStyle(cover) {
  if (!cover) return { background: 'linear-gradient(140deg,#243039,#141d23)' }
  const isImage = /^(data:|https?:|\/|\.\/)/.test(cover)
  return isImage
    ? { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: cover }
}
