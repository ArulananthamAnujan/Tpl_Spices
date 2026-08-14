import LegalPage from '../components/LegalPage';

export default function RefundsPage() {
  return (
    <LegalPage title="Refund & Returns Policy" updated="14 August 2026">
      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">1. Your consumer guarantee rights</h2>
        <p>
          Nothing in this policy limits any right or remedy you have under the Australian Consumer Law. If an item
          is faulty, not as described, or wrongly supplied, you're entitled to a repair, replacement, or refund
          regardless of what's written below.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">2. Wrong, missing or damaged items</h2>
        <p>
          Check your order when you collect or receive it. If something's missing, incorrect, or arrived damaged,
          contact your store within 48 hours with your order number and we'll arrange a replacement or refund.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">3. Change of mind</h2>
        <p>
          Because most of our range is food and consumable goods, we can only accept change-of-mind returns on
          unopened, unused, resaleable items in their original packaging, within 7 days of purchase. For hygiene
          reasons we can't accept returns of opened food items unless there's a quality issue.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">4. Pickup orders not collected</h2>
        <p>
          If a pickup order isn't collected within a reasonable time of the scheduled time (your store will confirm
          this window), we may cancel the order and refund it, less any perishable items that can't be restocked.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">5. Delivery issues</h2>
        <p>
          If a delivery doesn't arrive, or arrives significantly outside the estimated window, contact us and
          we'll investigate — including with our delivery partner where relevant — and offer a redelivery or
          refund as appropriate.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">6. How refunds are processed</h2>
        <p>
          Approved refunds are returned to your original payment method via Square, and typically appear within
          5–10 business days depending on your bank or card provider.
        </p>
      </section>

      <section>
        <h2 className="font-semibold text-tpl-dark text-base mb-2">7. Contact</h2>
        <p>
          To start a refund or return, contact us at{' '}
          <a href="mailto:sales@tplspice.com.au" className="text-tpl-forest underline">sales@tplspice.com.au</a> or{' '}
          <a href="tel:+61449722392" className="text-tpl-forest underline">+61 449 722 392</a> with your order
          number.
        </p>
      </section>
    </LegalPage>
  );
}
