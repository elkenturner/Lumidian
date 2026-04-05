import Link from 'next/link';

export const metadata = { title: 'Privacy Policy' };

const SECTIONS: Array<{
  title: string;
  body?: string;
  items?: Array<{ label: string; detail: string }>;
}> = [
  {
    title: '1. Introduction',
    body: `Lumidian ("we", "us", or "our") operates the Lumidian platform at lumidian.ai. This Privacy Policy explains what information we collect, how we use it, and your rights regarding that information. By using our Service, you agree to the practices described here.`,
  },
  {
    title: '2. Information We Collect',
    items: [
      { label: 'Account information', detail: 'Name, email address, and hashed password when you register. If you sign in with Google, we receive your name and email from Google.' },
      { label: 'Brand and prompt data', detail: 'Brand names, website URLs, tracking prompts, and competitor names that you submit to configure your tracking.' },
      { label: 'Usage data', detail: 'Pages visited, features used, report run times, and other interaction data to help us improve the product.' },
      { label: 'Billing information', detail: 'Payment is processed by Stripe. We do not store full card numbers. We receive billing status, plan tier, and transaction history from Stripe.' },
      { label: 'Device and log data', detail: 'IP address, browser type, and timestamps of requests made to our servers, retained for security and debugging purposes.' },
    ],
  },
  {
    title: '3. How We Use Your Information',
    items: [
      { label: 'To provide the Service', detail: 'We use your brand and prompt data to run visibility queries against third-party AI platforms and generate reports.' },
      { label: 'To operate and improve the product', detail: 'Usage data helps us identify bugs, improve features, and understand how people use Lumidian.' },
      { label: 'To communicate with you', detail: 'We send transactional emails (account confirmation, report notifications, billing receipts). We may also send product update emails — you can unsubscribe at any time.' },
      { label: 'To process payments', detail: 'Billing information is shared with Stripe to process subscription charges.' },
      { label: 'To comply with legal obligations', detail: 'We may retain and disclose data where required by law or to respond to valid legal process.' },
    ],
  },
  {
    title: '4. Data Shared with Third Parties',
    body: `When you run a visibility report, we submit your prompts to the following third-party AI platforms: OpenAI (ChatGPT), Anthropic (Claude), Perplexity, and Google (Gemini). Prompts are sent solely to generate visibility data and are subject to each platform's own terms and privacy policies. We also use Stripe for billing, and may use analytics tools such as Vercel Analytics. We do not sell your personal data to third parties.`,
  },
  {
    title: '5. Data Retention',
    body: `We retain your account data for as long as your account is active. Report results and trend data are stored for the duration of your subscription. If you delete your account, we delete your personal data within 30 days, except where retention is required for legal or fraud-prevention purposes.`,
  },
  {
    title: '6. Security',
    body: `We use industry-standard measures to protect your data, including encrypted storage, HTTPS-only communication, and hashed passwords. No method of transmission over the internet is completely secure, but we take reasonable precautions to protect your information.`,
  },
  {
    title: '7. Your Rights',
    body: `Depending on your location, you may have rights to: access the personal data we hold about you; correct inaccurate data; request deletion of your data; export your data in a machine-readable format; or object to certain processing. To exercise any of these rights, email us at privacy@lumidian.ai.`,
  },
  {
    title: '8. Cookies',
    body: `We use cookies and similar technologies to maintain your login session and remember preferences. We do not use third-party advertising cookies. You can configure your browser to reject cookies, but some features of the Service may not work correctly without them.`,
  },
  {
    title: '9. Children',
    body: `The Service is not directed at children under 18. We do not knowingly collect personal information from anyone under 18. If you believe a child has provided us with personal information, contact us and we will delete it.`,
  },
  {
    title: '10. Changes to This Policy',
    body: `We may update this Privacy Policy from time to time. We will notify you of significant changes by email or via an in-app notice. The "Last updated" date at the top of this page indicates when the policy was last revised.`,
  },
  {
    title: '11. Contact Us',
    body: `Questions, requests, or concerns about this Privacy Policy? Email us at privacy@lumidian.ai.`,
  },
];

export default function PrivacyPage() {
  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-3xl">
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Privacy Policy</h1>
        <p className="text-xs text-[var(--text-faint)] mt-2">Last updated: March 27, 2026</p>
      </div>

      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2">{section.title}</h2>
            {section.body ? (
              <p className="text-sm text-[var(--text-muted)] leading-relaxed">{section.body}</p>
            ) : (
              <ul className="space-y-2.5">
                {section.items?.map((item) => (
                  <li key={item.label} className="text-sm text-[var(--text-muted)] leading-relaxed">
                    <span className="text-[var(--text-secondary)] font-medium">{item.label}:</span>{' '}
                    {item.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="mt-12 pt-6 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-faint)]">
        <p>&copy; 2026 Lumidian. All rights reserved.</p>
        <div className="flex gap-4">
          <Link href="/terms" className="hover:text-[var(--text-muted)] transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-[var(--text-muted)] transition-colors">Privacy</Link>
        </div>
      </div>
    </div>
  );
}
