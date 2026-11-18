(() => {
  const button = document.getElementById('copyContract');
  const contract = document.getElementById('contract');
  const toast = document.getElementById('toast');
  if (!button || !contract) return;

  button.addEventListener('click', async () => {
    const value = contract.textContent.trim();
    try {
      await navigator.clipboard.writeText(value);
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    button.textContent = 'Copied ✓';
    toast.classList.add('show');
    window.setTimeout(() => {
      button.textContent = 'Copy address';
      toast.classList.remove('show');
    }, 1600);
  });
})();
