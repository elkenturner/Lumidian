'use client'

import { useEffect, useState } from 'react'

import { siteAudit, type WebsiteAuditFindingOut } from '@/lib/api'

const BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'anthropic-ai',
  'PerplexityBot', 'Google-Extended', 'Meta-ExternalAgent',
  'Applebot-Extended', 'Amazonbot',
]

// Map bot name → check_id used in backend findings
const BOT_CHECK_ID: Record<string, string> = {
  'GPTBot': 'blocked_gptbot',
  'OAI-SearchBot': 'blocked_oai_searchbot',
  'ClaudeBot': 'blocked_claudebot',
  'Google-Extended': 'blocked_google_extended',
  'PerplexityBot': 'blocked_perplexitybot',
}

export function BotAccessPanel({ auditId, robotsTxtRaw }:
  { auditId: number; robotsTxtRaw: string | null }) {
  const [findings, setFindings] = useState<WebsiteAuditFindingOut[]>([])
  useEffect(() => {
    siteAudit.findings(auditId).then(fs =>
      setFindings(fs.filter(f => f.category === 'bot_access')))
  }, [auditId])

  const status = (bot: string): { kind: string; level: 'ok' | 'warn' | 'bad' } => {
    const checkId = BOT_CHECK_ID[bot]
    if (checkId && findings.find(f => f.check_id === checkId)) {
      return { kind: 'disallowed', level: 'bad' }
    }
    return { kind: 'allowed', level: 'ok' }
  }

  return (
    <div className="grid gap-6">
      <section>
        <h3 className="font-medium mb-3">AI bot access</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {BOTS.map(bot => {
            const s = status(bot)
            return (
              <div key={bot} className="flex items-center justify-between border rounded px-3 py-2">
                <code>{bot}</code>
                <span className={
                  s.level === 'ok'   ? 'text-green-600' :
                  s.level === 'warn' ? 'text-yellow-600' : 'text-red-600'
                }>
                  {s.kind}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {robotsTxtRaw && (
        <section>
          <h3 className="font-medium mb-2">robots.txt</h3>
          <pre className="bg-muted p-3 rounded text-xs max-h-64 overflow-auto whitespace-pre-wrap break-all">{robotsTxtRaw}</pre>
        </section>
      )}
    </div>
  )
}
