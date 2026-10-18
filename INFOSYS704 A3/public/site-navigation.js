(function () {
  'use strict';
  const sidebar = document.querySelector('#sidebar');
  const toggle = document.querySelector('#navToggle');
  const backdrop = document.querySelector('#navBackdrop');
  const content = document.querySelector('[data-navigation-content]');
  if (!sidebar || !toggle || !backdrop) return;
  const phone = window.matchMedia('(max-width: 640px)');

  function setOpen(requested, restoreFocus = false) {
    const open = Boolean(requested && phone.matches);
    sidebar.classList.toggle('open', open);
    document.body.classList.toggle('navigation-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open;
    sidebar.inert = phone.matches && !open;
    if (content) content.inert = open;
    if (phone.matches && !open) sidebar.setAttribute('aria-hidden', 'true');
    else sidebar.removeAttribute('aria-hidden');
    if (open) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
      (sidebar.querySelector('[aria-current="page"]') || sidebar.querySelector('a'))?.focus();
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
      if (restoreFocus && phone.matches) toggle.focus();
    }
  }

  function close(restoreFocus = false) { setOpen(false, restoreFocus); }
  function setActive(key) {
    sidebar.querySelectorAll('a[data-nav]').forEach(link => {
      const active = link.dataset.nav === key;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  toggle.addEventListener('click', () => setOpen(!sidebar.classList.contains('open'), true));
  backdrop.addEventListener('click', () => close(true));
  sidebar.addEventListener('click', event => {
    const target = event.target.closest('a, [data-close-navigation]');
    if (target) close(target.tagName === 'A' || target.hasAttribute('data-navigation-dismiss'));
  });
  document.addEventListener('keydown', event => {
    if (!phone.matches || !sidebar.classList.contains('open')) return;
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    if (event.key === 'Tab') {
      const links = Array.from(sidebar.querySelectorAll('a[href], button:not(:disabled), summary, [tabindex="0"]'))
        .filter(element => element.getClientRects().length);
      const targets = [toggle].concat(links);
      const index = targets.indexOf(document.activeElement);
      const next = index < 0 ? (event.shiftKey ? targets.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length;
      event.preventDefault(); targets[next].focus();
    }
  });
  phone.addEventListener('change', () => close(phone.matches && sidebar.contains(document.activeElement)));
  window.addEventListener('hashchange', () => close());
  window.KmartNavigation = { close, setActive };
  close();
})();
