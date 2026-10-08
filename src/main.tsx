import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/600.css'
import '@fontsource/montserrat/700.css'
import './styles.css'

const updateSW = registerSW({ onNeedRefresh() { window.dispatchEvent(new CustomEvent('pwa-update')) } })
addEventListener('pwa-apply-update', () => { void updateSW(true) })
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
