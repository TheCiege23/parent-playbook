import Stripe from 'npm:stripe@16';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const auth = req.headers.get('Authorization') || '';
    const uc = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await uc.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
    const appUrl = Deno.env.get('APP_URL') || 'https://playbook.chimaura.com';

    const { data: prof } = await svc.from('trainer_profiles').select('id,stripe_account_id').eq('id', user.id).maybeSingle();
    if (!prof) return json({ error: 'Not a trainer profile' }, 400);
    let acct = prof.stripe_account_id as string | null;
    if (!acct) {
      const account = await stripe.accounts.create({
        type: 'express', country: 'US',
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_type: 'individual', metadata: { guardian_id: user.id },
      });
      acct = account.id;
      await svc.from('trainer_profiles').update({ stripe_account_id: acct }).eq('id', user.id);
    }
    const link = await stripe.accountLinks.create({
      account: acct,
      refresh_url: appUrl + '/?stripe=refresh',
      return_url: appUrl + '/?stripe=return',
      type: 'account_onboarding',
    });
    return json({ url: link.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400);
  }
});
