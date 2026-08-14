import LegalPage from '../components/LegalPage';

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="14 August 2026">
      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">1. Who we are</h2>
        <p>
          These Terms govern your use of the TPL Spices &amp; Groceries website and your purchase of products for
          pickup or delivery from our Melbourne stores. By creating an account, placing an order, or otherwise
          using this site, you agree to these Terms.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">2. Accounts</h2>
        <p>
          You're responsible for keeping your account credentials secure and for all activity under your account.
          Provide accurate information when you register, and let us know if you believe your account has been
          accessed without your permission.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">3. Orders, pricing &amp; payment</h2>
        <p>
          Prices are shown in Australian dollars and may change without notice; the price charged is the price
          shown at checkout at the time you pay. Payments are processed securely by Square — we don't store your
          full card details. We reserve the right to cancel and refund an order if an item's price or availability
          was listed in error, or if we're unable to fulfil it.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">4. Pickup &amp; delivery</h2>
        <p>
          Estimated pickup and delivery times are indicative, not guaranteed. Delivery is only available within
          the radius shown for your selected store, and a delivery fee may apply as shown at checkout. It's your
          responsibility to provide an accurate delivery address and to be available to receive the order, or
          nominate someone who can.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">5. Cancellations</h2>
        <p>
          Once an order has been paid for, contact your store directly as soon as possible if you need to cancel
          or change it — we can't guarantee changes once preparation has started. See our{' '}
          <a href="/refunds" className="text-tpl-forest underline">Refund &amp; Returns Policy</a> for how refunds
          are handled.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">6. Acceptable use</h2>
        <p>
          Don't misuse the site — that includes attempting to interfere with its operation, tampering with prices
          or orders, scraping content without permission, or using the site for any unlawful purpose.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">7. Liability</h2>
        <p>
          Nothing in these Terms limits any consumer guarantee you're entitled to under the Australian Consumer
          Law that can't lawfully be excluded. Beyond that, to the extent permitted by law, TPL Spices &amp;
          Groceries is not liable for indirect or consequential loss arising from your use of the site.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">8. Changes</h2>
        <p>
          We may update these Terms from time to time; continued use of the site after a change means you accept
          the updated Terms.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">9. Contact</h2>
        <p>
          Questions about these Terms? Reach us at{' '}
          <a href="mailto:sales@tplspice.com.au" className="text-tpl-forest underline">sales@tplspice.com.au</a> or{' '}
          <a href="tel:+61449722392" className="text-tpl-forest underline">+61 449 722 392</a>.
        </p>
      </section>
    </LegalPage>
  );
}
