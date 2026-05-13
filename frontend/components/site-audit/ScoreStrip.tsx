'use client';

import { motion } from 'framer-motion';
import { staggerContainer, staggerChild } from '@/lib/motion';
import { ScoreCard } from './ScoreCard';
import type { WebsiteAuditSummary } from '@/lib/api';

interface Props {
  audit: WebsiteAuditSummary;
}

const EXPLAIN: Record<string, string> = {
  overall:
    'A weighted blend of Bot Access, Content, Schema, and Technical scores. This is the headline measure of how visible your site is to AI search.',
  bot_access:
    'Can AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) reach your pages? Blocked bots are why your content never enters AI retrieval.',
  content:
    'Do your pages have the structural signals AI extracts from? H1s, titles, meta descriptions, factual density, and semantic HTML.',
  schema:
    'Do you provide JSON-LD structured data? AI uses schema to disambiguate your brand from competitors and parse pages into entities.',
  technical:
    'Can AI crawlers render and read your pages quickly? Render mode (SSR vs CSR), page weight, response times, broken links.',
};

export function ScoreStrip({ audit }: Props) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 sm:grid-cols-5 gap-3"
    >
      <motion.div variants={staggerChild} className="sm:col-span-1">
        <ScoreCard
          label="Overall"
          score={audit.overall_score}
          explanation={EXPLAIN.overall}
          emphasis
        />
      </motion.div>
      <motion.div variants={staggerChild}>
        <ScoreCard label="Bot access" score={audit.bot_access_score} explanation={EXPLAIN.bot_access} />
      </motion.div>
      <motion.div variants={staggerChild}>
        <ScoreCard label="Content" score={audit.content_score} explanation={EXPLAIN.content} />
      </motion.div>
      <motion.div variants={staggerChild}>
        <ScoreCard label="Schema" score={audit.schema_score} explanation={EXPLAIN.schema} />
      </motion.div>
      <motion.div variants={staggerChild}>
        <ScoreCard label="Technical" score={audit.technical_score} explanation={EXPLAIN.technical} />
      </motion.div>
    </motion.div>
  );
}
