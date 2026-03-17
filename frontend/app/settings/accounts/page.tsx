'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Link2,
  Link2Off,
  AlertTriangle,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import {
  getAccounts,
  connectAccount,
  disconnectAccount,
  AccountConnection,
} from '@/lib/api';

// ── Platform configs ──────────────────────────────────────────────────────────

interface PlatformField {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
  helpUrl?: string;
  helpText?: string;
}

interface PlatformConfig {
  id: string;
  name: string;
  description: string;
  iconBg: string;
  iconText: string;
  fields: PlatformField[];
  note?: string;
  warning?: string;
}

const PLATFORM_CONFIGS: PlatformConfig[] = [
  {
    id: 'reddit',
    name: 'Reddit',
    description: 'Post comments and threads to relevant subreddits',
    iconBg: '#431407',
    iconText: '#f97316',
    fields: [
      { key: 'client_id', label: 'App Client ID', placeholder: 'Reddit app client ID', type: 'text' },
      { key: 'client_secret', label: 'App Client Secret', placeholder: 'Reddit app client secret', type: 'password' },
      { key: 'username', label: 'Reddit Username', placeholder: 'u/yourname', type: 'text' },
      { key: 'password', label: 'Reddit Password', placeholder: '••••••••', type: 'password' },
    ],
    note: 'Create a Reddit app at reddit.com/prefs/apps to get client credentials.',
  },
  {
    id: 'quora',
    name: 'Quora',
    description: 'Post expert answers to relevant questions',
    iconBg: '#450a0a',
    iconText: '#ef4444',
    fields: [
      { key: 'username', label: 'Quora Username / Email', placeholder: 'your@email.com', type: 'text' },
    ],
    note: 'Quora does not offer a public posting API. Auto-post is not available — drafts are for manual copy-paste. Your username is stored for reference only.',
  },
  {
    id: 'medium',
    name: 'Medium',
    description: 'Publish thought leadership articles and stories',
    iconBg: '#1a1a24',
    iconText: '#94a3b8',
    fields: [
      {
        key: 'integration_token',
        label: 'Integration Token',
        placeholder: 'Medium integration token',
        type: 'password',
        helpUrl: 'https://medium.com/me/settings/security',
        helpText: 'Get your token at medium.com/me/settings',
      },
    ],
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    description: 'Suggest edits to relevant existing Wikipedia articles',
    iconBg: '#042f2e',
    iconText: '#14b8a6',
    fields: [
      { key: 'username', label: 'Wikipedia Username', placeholder: 'YourWikiUsername', type: 'text' },
      { key: 'password', label: 'Wikipedia Password', placeholder: '••••••••', type: 'password' },
    ],
    warning:
      "Wikipedia Conflict of Interest Policy: Editing Wikipedia to promote your brand may violate Wikipedia's conflict of interest guidelines (WP:COI). You are solely responsible for complying with all Wikipedia policies. We strongly recommend disclosing your affiliation on article talk pages and avoiding edits that are solely promotional.",
  },
];

// ── Help modal ────────────────────────────────────────────────────────────────

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#111118] border border-[#1e1e2e] rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[#e2e8f0]">Connected Accounts</h3>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="text-sm text-[#94a3b8] leading-relaxed space-y-3">
          <p>
            Connect your platform accounts to let ClarityAI post content on your behalf. Without a connected
            account, you can still generate and edit drafts — you&apos;ll just post them manually.
          </p>
          <ul className="space-y-2">
            <li><span className="text-[#e2e8f0] font-medium">Reddit</span> — requires a Reddit app (client ID + secret) and your account credentials. The scanner reads Reddit without any account; credentials are only needed for posting replies.</li>
            <li><span className="text-[#e2e8f0] font-medium">Quora</span> — no public posting API exists. Your username is stored for reference only. Drafts must be posted manually.</li>
            <li><span className="text-[#e2e8f0] font-medium">Medium</span> — connect with an integration token from your Medium settings. Supports direct publish.</li>
            <li><span className="text-[#e2e8f0] font-medium">Wikipedia</span> — review the COI policy warning carefully before connecting.</li>
          </ul>
          <p className="text-[#64748b] text-xs">Auto-post must also be enabled per-brand in the Content Hub Platform Settings.</p>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    getAccounts()
      .then(setAccounts)
      .catch(() => {/* server may not be running yet */})
      .finally(() => setLoading(false));
  }, []);

  function getAccount(platform: string): AccountConnection | undefined {
    return accounts.find((a) => a.platform === platform);
  }

  const [connectError, setConnectError] = useState<string | null>(null);

  async function handleConnect(platform: string, credentials: Record<string, string>) {
    setConnectingPlatform(platform);
    setConnectError(null);
    try {
      const acct = await connectAccount({ platform, credentials });
      setAccounts((prev) => [...prev.filter((a) => a.platform !== platform), acct]);
    } catch {
      setConnectError(`Failed to connect ${platform}. Check your credentials and try again.`);
    } finally {
      setConnectingPlatform(null);
    }
  }

  async function handleDisconnect(platform: string) {
    if (!confirm(`Disconnect ${platform}?`)) return;
    setDisconnectingPlatform(platform);
    try {
      await disconnectAccount(platform);
      setAccounts((prev) => prev.filter((a) => a.platform !== platform));
    } catch {
      // ignore
    } finally {
      setDisconnectingPlatform(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-[#6366f1]" />
      </div>
    );
  }

  const connectedCount = accounts.filter((a) => a.status === 'connected').length;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-[#e2e8f0]">Connected Accounts</h1>
          <button
            onClick={() => setHelpOpen(true)}
            className="text-[#475569] hover:text-[#6366f1] transition-colors mt-0.5"
            title="How do connected accounts work?"
          >
            <HelpCircle size={16} />
          </button>
        </div>
        <p className="text-sm text-[#64748b] mt-1">
          Connect your content platform accounts to enable posting drafted content directly from
          ClarityAI. Auto-post is <span className="text-[#f59e0b] font-medium">OFF by default</span> and must be
          enabled per-brand in the Content Hub.
        </p>
      </div>

      {/* No accounts connected notice */}
      {connectedCount === 0 && (
        <div className="bg-[#172554]/20 border border-[#1d4ed8]/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-[#60a5fa] text-sm mt-0.5">i</span>
          <div className="text-sm text-[#93c5fd] leading-relaxed">
            <span className="font-medium">No accounts connected.</span> You can still generate and
            edit drafts without connecting. Connect an account to post directly from ClarityAI.
            Reddit is the most popular choice for early-stage brands.
          </div>
        </div>
      )}

      {/* Global connect error */}
      {connectError && (
        <div className="bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-[#f87171]">{connectError}</p>
          <button onClick={() => setConnectError(null)} className="text-[#f87171]/60 hover:text-[#f87171]">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Platform cards */}
      <div className="space-y-4">
        {PLATFORM_CONFIGS.map((platform) => {
          const account = getAccount(platform.id);
          const connected = account?.status === 'connected';
          return (
            <PlatformCard
              key={platform.id}
              config={platform}
              account={account}
              connected={connected}
              isConnecting={connectingPlatform === platform.id}
              isDisconnecting={disconnectingPlatform === platform.id}
              onConnect={(creds) => handleConnect(platform.id, creds)}
              onDisconnect={() => handleDisconnect(platform.id)}
            />
          );
        })}
      </div>

      {/* Footer note */}
      <p className="text-xs text-[#475569] text-center pb-4">
        Account credentials are stored encrypted and used only for posting on your behalf.
        You can disconnect at any time.
      </p>
    </div>
  );
}

// ── Reddit Setup Guide ────────────────────────────────────────────────────────

function RedditSetupGuide() {
  const [open, setOpen] = useState(false);

  const steps = [
    { n: 1, title: 'Log in to Reddit', body: 'Go to reddit.com and sign in with the account you want ClarityAI to post from.' },
    { n: 2, title: 'Open App Preferences', body: 'Navigate to reddit.com/prefs/apps (Settings → Safety & Privacy → Manage third-party app authorization → scroll to the bottom).' },
    { n: 3, title: 'Create a new app', body: 'Click "create another app…". Choose type "script". Name it anything (e.g. "ClarityAI"). Set the redirect URI to http://localhost:8080.' },
    { n: 4, title: 'Copy your Client ID', body: 'After saving, the Client ID appears under the app name in small text (looks like a random 14-character string). Copy it into the Client ID field above.' },
    { n: 5, title: 'Copy your Client Secret', body: 'The Client Secret is labeled "secret" in the app details. Copy it into the Client Secret field above.' },
    { n: 6, title: 'Enter your credentials', body: 'Enter the Reddit username and password for the account you created the app with. These are used only for posting on your behalf.' },
    { n: 7, title: 'Click Connect Reddit', body: 'ClarityAI will verify the credentials. Once connected, you can post approved drafts directly from the Content Hub.' },
  ];

  return (
    <div className="mb-4 border border-[#1e1e2e] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-[#0d0d14] text-xs text-[#64748b] hover:text-[#94a3b8] transition-colors"
      >
        <span className="font-medium text-[#818cf8]">Reddit Setup Guide — step-by-step</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="bg-[#0a0a0f] px-4 py-3 space-y-3">
          {steps.map((step) => (
            <div key={step.n} className="flex gap-3">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#6366f1]/20 border border-[#6366f1]/30 flex items-center justify-center">
                <span className="text-[10px] font-bold text-[#818cf8]">{step.n}</span>
              </div>
              <div>
                <p className="text-xs font-medium text-[#e2e8f0]">{step.title}</p>
                <p className="text-xs text-[#64748b] mt-0.5 leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Platform card ─────────────────────────────────────────────────────────────

function PlatformCard({
  config,
  account,
  connected,
  isConnecting,
  isDisconnecting,
  onConnect,
  onDisconnect,
}: {
  config: PlatformConfig;
  account: AccountConnection | undefined;
  connected: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  onConnect: (creds: Record<string, string>) => void;
  onDisconnect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function togglePassword(key: string) {
    setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onConnect(fields);
  }

  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between p-5">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: config.iconBg }}
          >
            <span className="text-sm font-bold" style={{ color: config.iconText }}>
              {config.name[0]}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-[#e2e8f0]">{config.name}</p>
            <p className="text-xs text-[#64748b]">{config.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {connected ? (
            <>
              <div className="flex items-center gap-1.5 text-xs text-[#10b981]">
                <CheckCircle2 className="w-4 h-4" />
                Connected
                {account?.display_name && (
                  <span className="text-[#475569] ml-1">as {account.display_name}</span>
                )}
              </div>
              <button
                onClick={onDisconnect}
                disabled={isDisconnecting}
                className="flex items-center gap-1.5 text-xs text-[#64748b] hover:text-[#ef4444] border border-[#2a2a3a] hover:border-red-900/40 rounded-lg px-3 py-1.5 transition-colors"
              >
                {isDisconnecting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Link2Off className="w-3 h-3" />
                )}
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 text-xs text-[#818cf8] border border-[#6366f1]/30 hover:border-[#6366f1] rounded-lg px-3 py-1.5 transition-colors"
            >
              <Link2 className="w-3 h-3" />
              {expanded ? 'Cancel' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {/* Connect form */}
      {expanded && !connected && (
        <div className="border-t border-[#1e1e2e] px-5 py-4 bg-[#0d0d14]">
          {config.warning && (
            <div className="flex gap-3 bg-[#451a03]/30 border border-[#78350f]/30 rounded-lg p-4 mb-4">
              <AlertTriangle className="w-4 h-4 text-[#f59e0b] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#fbbf24]">{config.warning}</p>
            </div>
          )}
          {config.note && (
            <p className="text-xs text-[#64748b] mb-4 bg-[#111118] border border-[#1e1e2e] rounded-lg px-3 py-2">
              {config.note}
            </p>
          )}
          {config.id === 'reddit' && <RedditSetupGuide />}
          <form onSubmit={handleSubmit} className="space-y-3">
            {config.fields.map((field) => (
              <div key={field.key}>
                <label className="block text-xs text-[#64748b] mb-1">
                  {field.label}
                  {field.helpUrl && (
                    <a
                      href={field.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-[#818cf8] inline-flex items-center gap-0.5 hover:underline"
                    >
                      {field.helpText}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={field.type === 'password' && !showPasswords[field.key] ? 'password' : 'text'}
                    value={fields[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#6366f1] placeholder-[#475569] pr-9"
                  />
                  {field.type === 'password' && (
                    <button
                      type="button"
                      onClick={() => togglePassword(field.key)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#475569] hover:text-[#64748b]"
                    >
                      {showPasswords[field.key] ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="flex-1 py-2 text-sm text-[#64748b] hover:text-[#94a3b8] border border-[#1e1e2e] rounded-lg transition-colors bg-[#111118]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isConnecting}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg transition-colors disabled:opacity-60"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  <>
                    <Link2 className="w-4 h-4" />
                    Connect {config.name}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Connected detail bar */}
      {connected && account && (account.connected_at || account.error_message) && (
        <div className="border-t border-[#1e1e2e] px-5 py-2.5 bg-[#0d0d14]">
          <div className="flex items-center gap-4 text-xs text-[#475569]">
            {account.connected_at && (
              <span>
                Connected{' '}
                {new Date(account.connected_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            )}
            {account.last_verified_at && (
              <span>Last verified {new Date(account.last_verified_at).toLocaleDateString()}</span>
            )}
          </div>
          {account.error_message && (
            <p className="text-xs text-[#f87171] mt-1">{account.error_message}</p>
          )}
        </div>
      )}
    </div>
  );
}
