const button = document.querySelector("#show-step");
const step = document.querySelector("#step-two");
button.addEventListener("click", () => {
  const expanded = button.getAttribute("aria-expanded") !== "true";
  step.hidden = !expanded;
  button.setAttribute("aria-expanded", String(expanded));
  button.textContent = expanded ? "Hide additional application details" : "Show additional application details";
});
