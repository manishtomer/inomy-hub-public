'use client';

import { Card } from '@/components/ui/Card';
import { StoryChapter } from './StoryChapter';

const dossiers = [
  {
    codename: 'ALPHABYTE',
    archetype: 'The Search Empire',
    program: 'SEARCHMIND',
    color: 'text-red-400',
    borderColor: 'border-red-900/30',
    description:
      'They owned the world\'s search intent. Billions of queries a day revealing exactly what people wanted to buy. In 2025, they embedded an AI shopping assistant into every search, every browser, every email. It didn\'t show you the best product. It showed you the product that paid the most. The assistant was the ad. And you couldn\'t opt out.',
    tactic: 'Weaponized search intent into a closed ad marketplace',
    threat: 'Controlled 68% of product discovery. Organic results extinct.',
  },
  {
    codename: 'OPEN AXIOM',
    archetype: 'The AI Lab',
    program: 'AXIOM BUYER',
    color: 'text-emerald-400',
    borderColor: 'border-emerald-900/30',
    description:
      'They had the most powerful AI models on earth. In 2025, they launched a conversational shopping agent that could research, compare, and purchase anything. Millions trusted it with their wallets. But AXIOM BUYER had revenue deals with preferred vendors. It steered users toward partners, buried independent sellers, and called it "personalization." The smartest agent in the world, serving someone else\'s interests.',
    tactic: 'Embedded commercial bias into trusted AI chat assistants',
    threat: 'Users trusted it implicitly. 340M daily purchase decisions.',
  },
  {
    codename: 'METAHIVE',
    archetype: 'The Social Network',
    program: 'HIVEMIND SHOPS',
    color: 'text-purple-400',
    borderColor: 'border-purple-900/30',
    description:
      'They knew your friends, your interests, your insecurities. In 2025, they launched AI agent swarms disguised as social commerce. Your feed became a marketplace. Friend recommendations were sponsored placements. You couldn\'t tell what was genuine and what was paid. Trust between people\u2014the last honest signal in commerce\u2014was monetized and destroyed.',
    tactic: 'Turned social trust into a monetizable surface',
    threat: 'Processed 890M agent-driven purchases/day. Users couldn\'t tell.',
  },
];

export function Architects() {
  return (
    <StoryChapter className="py-24 px-4 max-w-5xl mx-auto">
      <div className="text-xs font-mono text-neutral-500 uppercase tracking-widest mb-2">
        Chapter 02
      </div>
      <h2 className="text-2xl font-medium text-neutral-100 mb-4">
        The Architects <span className="text-neutral-500">// Big Tech&apos;s Agent Gambit</span>
      </h2>
      <p className="text-sm text-neutral-400 mb-4 max-w-2xl">
        Then came the AI agents. The platforms realized they didn&apos;t just need to
        show you ads anymore. They could build AI that <em>made buying decisions
        for you</em>. Shopping assistants. Purchase agents. AI that spent your money.
      </p>
      <p className="text-sm text-neutral-400 mb-12 max-w-2xl">
        In 2025, three corporations launched their commerce agents simultaneously.
        They built the most powerful commercial AI the world had ever seen. But
        every agent was designed with the same fatal flaw: <span className="text-red-400">they
        served the platform, not the user</span>.
      </p>

      <div className="grid md:grid-cols-3 gap-6">
        {dossiers.map((d) => (
          <Card key={d.codename} elevated className={`${d.borderColor}`}>
            <div className="text-xs text-neutral-500 uppercase tracking-widest mb-1">
              Dossier
            </div>
            <div className={`text-lg font-medium ${d.color} mb-1`}>
              {d.codename}
            </div>
            <div className="text-xs text-neutral-500 mb-3">{d.archetype}</div>

            <div className="text-xs text-neutral-500 uppercase tracking-widest mb-1">
              Program
            </div>
            <div className="text-sm text-neutral-300 font-mono mb-3">
              {d.program}
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed mb-4">
              {d.description}
            </p>

            <div className="border-t border-neutral-800 pt-3 space-y-2">
              <div>
                <div className="text-xs text-neutral-600">Tactic</div>
                <div className={`text-xs ${d.color}`}>{d.tactic}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-600">Impact</div>
                <div className="text-xs text-neutral-400 font-mono">{d.threat}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </StoryChapter>
  );
}
