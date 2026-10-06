// Where Stripe sends someone back to after Checkout or Connect onboarding.
//
// The website is a single page at appUrl/, so the return parameters land on it directly. The iOS and
// Android apps open Stripe in an in-app browser sheet instead (js/native.js), and a redirect back to
// playbookbp.com would just load the website inside that sheet. They ask for return_to:'app', which
// lands on appUrl/app-return — a tiny static page whose only job is a button back into the app.
export function stripeReturnBase(appUrl, body) {
  return body && body.return_to === 'app' ? appUrl + '/app-return' : appUrl + '/';
}
