import react from '@vitejs/plugin-react'

export default {
  plugins: [react()],
  server: {
    proxy: {
      '/ollama': {
        target: 'http://127.0.0.1:11434',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },

      '/box': {
  target: 'http://192.168.1.101:5000',
  changeOrigin: true,
  secure: false,
  rewrite: (path) => path.replace(/^\/box/, ''),}
      }
    }
  }
  
