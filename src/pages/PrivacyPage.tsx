import LegalPage from '../components/LegalPage';

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="14 August 2026">
      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">1. What we collect</h2>
        <p>
          When you create an account or place an order we collect your name, email address, phone number, and —
          for delivery orders — your delivery address. We also keep a record of your orders so you can view your
          order history and so our staff can fulfil them.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">2. How we use it</h2>
        <p>
          We use your information to process and fulfil orders, manage your account, respond to enquiries, and
          keep our records accurate. We don't sell your personal information to third parties.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">3. Who we share it with</h2>
        <p>
          Payment details are handled directly by Square, our payment processor — we never see or store your full
          card number. Our website and order data are hosted on Supabase. Both providers process data on our
          behalf under their own security and privacy commitments.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">4. Data retention</h2>
        <p>
          We keep account and order records for as long as your account is active, and as needed to meet our
          accounting and legal obligations after that.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">5. Your rights</h2>
        <p>
          You can review and update your details from your account page at any time. To request a copy of your
          data or ask us to delete your account, contact us using the details below.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">6. Security</h2>
        <p>
          We use industry-standard measures — including encrypted connections and access-controlled databases — to
          protect your information, but no online system can be guaranteed 100% secure.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">7. Contact</h2>
        <p>
          Privacy questions or requests: <a href="mailto:sales@tplspice.com.au" className="text-tpl-forest underline">sales@tplspice.com.au</a>.
        </p>
      </section>
    </LegalPage>
  );
}
