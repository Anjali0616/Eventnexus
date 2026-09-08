// eSewa's ePay v2 checkout is initiated by a real HTML form POST to their
// gateway (not a fetch/XHR redirect like Stripe's session.url), so the
// signed fields the backend returns get built into a throwaway form and
// auto-submitted — this navigates the browser to eSewa exactly as if the
// user had submitted a payment form by hand.
const ESEWA_ALLOWED_ACTIONS = [
  /^https:\/\/rc-epay\.esewa\.com\.np\/api\/epay\/main\/v2\/form\/?$/i,
  /^https:\/\/rc\.esewa\.com\.np\/api\/epay\/transaction\/status\/?$/i,
  /^https:\/\/epay\.esewa\.com\.np\/api\/epay\/main\/v2\/form\/?$/i,
  /^https:\/\/esewa\.com\.np\//i,
];

export function submitEsewaForm(action: string, fields: Record<string, string>) {
  if (!ESEWA_ALLOWED_ACTIONS.some((re) => re.test(String(action)))) {
    throw new Error(`Blocked untrusted eSewa action URL: ${String(action).slice(0, 120)}`);
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.style.display = "none";
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
  // Clean up after navigation starts; remove after short delay to avoid orphan DOM nodes on retry
  setTimeout(() => {
    try {
      if (form.parentNode) form.parentNode.removeChild(form);
    } catch {}
  }, 5000);
}
