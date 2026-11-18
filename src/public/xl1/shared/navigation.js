(function () {
  'use strict'
  const button = document.querySelector('.nav-toggle')
  const nav = document.getElementById('xl1-nav')
  if (!button || !nav) return
  button.addEventListener('click', () => {
    const open = nav.classList.toggle('open')
    button.setAttribute('aria-expanded', String(open))
  })
  nav.addEventListener('click', () => {
    nav.classList.remove('open')
    button.setAttribute('aria-expanded', 'false')
  })
})()
