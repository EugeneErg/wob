// Reading files the player picks — no external dependencies.


export function pickJSON() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return reject(new Error('No file chosen'))
      const reader = new FileReader()
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result))) } catch (e) { reject(new Error('The file is damaged')) }
      }
      reader.onerror = () => reject(new Error('Could not read the file'))
      reader.readAsText(file)
    }
    input.click()
  })
}

// raw: true отдаёт сам файл, а не data-URL.
//
// Картинка, вшитая в JSON как data-URL, — терпимо, пока она обложка; для всего,
// что уезжает на сервер, это лишний круг: base64 раздувает байты на треть, и
// библиотека начинает таскать содержимое картинок внутри себя. Обложки, которые
// грузятся в облако, ходят файлом и хранятся ссылкой.
export function pickImage({ raw = false, accept = 'image/*' } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return reject(new Error('No file chosen'))
      if (raw) return resolve(file)
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Could not read the image'))
      reader.readAsDataURL(file)
    }
    input.click()
  })
}


// Обложка: либо картинка (URL или data:), либо любая css-заливка
export function coverStyle(cover) {
  if (!cover) return { background: 'linear-gradient(140deg,#243039,#141d23)' }
  const isImage = /^(data:|https?:|\/|\.\/)/.test(cover)
  return isImage
    ? { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: cover }
}

