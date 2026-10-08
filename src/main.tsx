import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import '@fontsource/pt-sans/400.css'
import '@fontsource/pt-sans/700.css'
import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/600.css'
import './styles.css'

const updateSW = registerSW({ onNeedRefresh() { window.dispatchEvent(new CustomEvent('pwa-update')) } })
addEventListener('pwa-apply-update', () => { void updateSW(true) })
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
