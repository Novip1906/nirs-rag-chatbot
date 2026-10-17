function nfTogglePassword(btn) {
  var wrapper = btn.closest('.nf-field-password');
  var input = wrapper.querySelector('input');
  var isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  wrapper.classList.toggle('nf-password-visible', isPassword);
}
