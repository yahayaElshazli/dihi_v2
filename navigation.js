// ---- Tab and menu navigation ----
document.querySelectorAll('.bottom-nav [data-tab]').forEach(button => button.addEventListener('click', () => {
  const tab = button.dataset.tab;
  document.querySelectorAll('main .tab').forEach(section => section.classList.toggle('active', section.id === `tab-${tab}`));
  document.querySelectorAll('.bottom-nav [data-tab]').forEach(item => item.classList.toggle('active', item === button));
  closeMenu();
}));
const drawer = document.getElementById('drawer');
const backdrop = document.getElementById('drawerBackdrop');
function closeMenu() {
  drawer.classList.remove('open'); backdrop.classList.remove('open');
  document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
}
document.getElementById('menuBtn').addEventListener('click', () => {
  const open = drawer.classList.toggle('open'); backdrop.classList.toggle('open', open);
  document.getElementById('menuBtn').setAttribute('aria-expanded', String(open));
});
backdrop.addEventListener('click', closeMenu);
document.getElementById('adminMenuBtn').addEventListener('click', () => {
  document.querySelectorAll('main .tab').forEach(section => section.classList.toggle('active', section.id === 'tab-admin'));
  document.querySelectorAll('.bottom-nav [data-tab]').forEach(item => item.classList.remove('active'));
  closeMenu();
});
