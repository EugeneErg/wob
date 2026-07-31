import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

// Единственное место, где перечисляются конкретные сущности проекта.
// В будущем можно заменить на fetch с сервера + registerEntity в цикле.
import './entities/index.js'

createApp(App).mount('#app')
