import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deployed separately from the ClassTap app (see kora/README.md — Vercel, root directory
// "kora/app"), so this always serves from "/" rather than a GitHub Pages repo subpath.
export default defineConfig({
  plugins: [react()],
})
