(function () {
  'use strict'

  const frame = document.getElementById('game')
  if (!frame) return

  const translate = value => String(value || '')
    // Mole Spades predates the arcade's XL1 rewards. Mole Hub's text points players here for
    // XL1; inside the arcade that becomes what actually happens. The first pattern is the
    // pre-2026-11-07 wording, kept for anyone with the old Mole Hub page cached.
    .replace(/XL1 support is planned for a future payout adapter and is not active\./g, 'In the XL1 Arcade, a finished match earns XL1 for the time played.')
    .replace(/To earn XL1 for Mole Spades instead, play it from the XL1 Arcade \(Play for XL1 on its Mole Hub card\)\./g, 'In the XL1 Arcade, a finished match earns XL1 for the time played.')
    .replace(/To earn XL1 for Mole Spades, play it from the XL1 Arcade \(Play for XL1\)/g, 'In the XL1 Arcade, a finished match earns XL1 for the time played')
    .replace(/^IN XL1 ARCADE$/, 'LIVE HERE')
    .replace(/^Earn XL1 for this game from the XL1 Arcade$/, 'Finished matches earn XL1 for time played')
    .replace(/Back to Hub/g, 'Back to Arcade')
    .replace(/Stored WinLEW/gi, 'Stored game points')
    .replace(/WinLEW wallet/gi, 'game-point total')
    .replace(/WinLEW/gi, 'game points')

  function scrub(win, root) {
    const walker = win.document.createTreeWalker(root, win.NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(node => {
      const next = translate(node.nodeValue)
      if (next !== node.nodeValue) node.nodeValue = next
    })
    root.querySelectorAll?.('[title],[aria-label],[placeholder]').forEach(node => {
      for (const name of ['title', 'aria-label', 'placeholder']) {
        if (node.hasAttribute(name)) node.setAttribute(name, translate(node.getAttribute(name)))
      }
    })
  }

  frame.addEventListener('load', () => {
    const win = frame.contentWindow
    scrub(win, win.document)
    new win.MutationObserver(records => records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (node.nodeType === win.Node.TEXT_NODE) {
          const next = translate(node.nodeValue)
          if (next !== node.nodeValue) node.nodeValue = next
        } else if (node.nodeType === win.Node.ELEMENT_NODE) {
          scrub(win, node)
        }
      })
    })).observe(win.document.documentElement, { childList: true, subtree: true })
  })
})()
