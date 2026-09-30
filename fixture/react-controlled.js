const h = React.createElement;

function ControlledForm() {
  const [email, setEmail] = React.useState("");
  const [note, setNote] = React.useState("React is controlling the email field.");
  return h("form", { onSubmit: (event) => event.preventDefault() },
    h("label", { htmlFor: "react-email" }, "Email address"),
    h("input", {
      id: "react-email",
      name: "email",
      type: "email",
      autoComplete: "email",
      value: email,
      onChange: (event) => setEmail(event.target.value)
    }),
    h("p", { role: "status" }, note),
    h("button", { type: "button", onClick: () => setNote(`Current React value length: ${email.length}`) }, "Read React state")
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(ControlledForm));
