export function focusAndPulseInput() {
  if (typeof document === "undefined") return;
  const form = document.getElementById("vett-form");
  const input = document.getElementById("url-input");
  if (!form || !input) return;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => {
    input.focus();
    form.classList.remove("vett-url-pulse");
    void form.offsetWidth;
    form.classList.add("vett-url-pulse");
  }, 350);
}
