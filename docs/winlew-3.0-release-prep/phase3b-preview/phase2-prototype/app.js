(function () {
  'use strict';

  const menuButton = document.querySelector('[data-menu-toggle]');
  const mobileMenu = document.querySelector('[data-mobile-menu]');
  const dialog = document.querySelector('[data-dialog]');

  function closeMenu() {
    if (!menuButton || !mobileMenu) return;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.querySelector('.sr-only').textContent = 'Open navigation';
    mobileMenu.hidden = true;
  }

  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!open));
    menuButton.querySelector('.sr-only').textContent = open ? 'Open navigation' : 'Close navigation';
    mobileMenu.hidden = open;
  });

  mobileMenu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

  document.querySelectorAll('[data-account]').forEach((button) => {
    button.addEventListener('click', () => {
      closeMenu();
      if (typeof dialog?.showModal === 'function') dialog.showModal();
    });
  });

  document.querySelector('[data-dialog-close]')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  const filters = [...document.querySelectorAll('[data-filter]')];
  const products = [...document.querySelectorAll('[data-group]')];
  filters.forEach((button) => button.addEventListener('click', () => {
    const filter = button.dataset.filter;
    filters.forEach((item) => item.setAttribute('aria-selected', String(item === button)));
    products.forEach((card) => {
      const groups = card.dataset.group.split(/\s+/);
      card.hidden = filter !== 'all' && !groups.includes(filter);
    });
  }));
})();
