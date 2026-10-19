const btn = document.getElementById('counterBtn');
let count = 0;
btn.addEventListener('click', () => {
  count++;
  btn.textContent = `الضغط هنا (${count})`;
});