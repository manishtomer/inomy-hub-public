'use client';

import { Card } from '@/components/ui/Card';
import { StoryChapter } from './StoryChapter';

export function OldWorld() {
  return (
    <StoryChapter className="py-24 px-4 max-w-5xl mx-auto">
      <div className="text-xs font-mono text-neutral-500 uppercase tracking-widest mb-2">
        Chapter 01
      </div>
      <h2 className="text-2xl font-medium text-neutral-100 mb-12">
        The Old World <span className="text-neutral-500">// When Commerce Lost Its Soul</span>
      </h2>

      <div className="grid md:grid-cols-2 gap-8 items-start">
        <div className="space-y-5 text-sm text-neutral-400 leading-relaxed">
          <p>
            Commerce used to be simple. You needed something, you found someone
            who made it, you exchanged value. Trust was local. Reputation was earned
            face to face.
          </p>
          <p>
            Then the platforms came. They promised to connect the world&mdash;buyers
            to sellers, supply to demand. But the platforms didn&apos;t make money
            from commerce. They made money from <span className="text-amber-400">attention</span>.
            Ads. Clicks. Engagement. The entire internet was restructured around
            a single question: <em>how do we keep them looking?</em>
          </p>
          <p>
            Search results stopped showing the best products. They showed whoever
            paid the most. Social feeds stopped surfacing what you wanted. They
            surfaced what kept you scrolling. User intent&mdash;the trillion-dollar
            signal of what people actually need&mdash;was captured, monetized, and
            sold back to the highest bidder.
          </p>
          <p>
            Sellers couldn&apos;t reach buyers without paying the toll. Small businesses
            were priced out of their own customers. Margins collapsed under the
            weight of ad-tax. And the platforms? They got richer with every click.
          </p>
          <p className="text-neutral-300 font-medium">
            Trust was the first casualty. When every recommendation is an ad in
            disguise, you stop trusting any of them.
          </p>
        </div>

        <Card elevated className="font-mono">
          <div className="text-xs text-neutral-500 uppercase tracking-widest mb-4">
            State of Commerce // 2025
          </div>
          <div className="space-y-4">
            <div>
              <div className="text-neutral-500 text-xs mb-1">Global Ad Spend</div>
              <div className="text-2xl text-amber-500">$842B</div>
              <div className="text-xs text-neutral-600">paid to reach your own customers</div>
            </div>
            <div>
              <div className="text-neutral-500 text-xs mb-1">Average Conversion Rate</div>
              <div className="text-2xl text-red-400">0.3%</div>
              <div className="text-xs text-neutral-600">99.7% of ad spend wasted</div>
            </div>
            <div>
              <div className="text-neutral-500 text-xs mb-1">Consumer Trust in Recommendations</div>
              <div className="text-2xl text-red-400">12%</div>
              <div className="text-xs text-neutral-600">lowest on record</div>
            </div>
            <div>
              <div className="text-neutral-500 text-xs mb-1">User Intent Captured by Platforms</div>
              <div className="text-2xl text-neutral-300">100%</div>
              <div className="text-xs text-neutral-600">users own none of their own data</div>
            </div>
          </div>
        </Card>
      </div>
    </StoryChapter>
  );
}
