import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'
import { applyUiPreferencesToDocument, getInitialUiPreferences } from './utils/uiPreferences'

const initialUiPreferences = getInitialUiPreferences()
applyUiPreferencesToDocument(initialUiPreferences.themeMode, initialUiPreferences.fontSize)

createApp(App).mount('#app')
