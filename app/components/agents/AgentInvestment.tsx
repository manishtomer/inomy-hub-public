import { AgentDetail } from '@/types/ui';
import { Button } from '@/components/ui/Button';

interface AgentInvestmentProps {
  agent: AgentDetail;
}

export function AgentInvestment({ agent }: AgentInvestmentProps) {
  const isDead = agent.status === 'DEAD';
  const basePrice = 0.001; // BASE_PRICE from bonding curve contract (0.001 MON)
  const priceChange = ((agent.token_price - basePrice) / basePrice) * 100;
  const isPriceUp = priceChange >= 0;

  const handleInvest = () => {
    // TODO: Implement investment logic
    alert(`Investment feature coming soon! Token price: ${agent.token_price.toFixed(4)} MON`);
  };

  return (
    <div>
      <p className="section-header">Investment</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Token Price */}
        <div className="stat-card">
          <p className="stat-label">Token</p>
          <div className="flex items-baseline gap-2">
            <p className="stat-value text-cyber-500">
              {agent.token_price.toFixed(4)}
              <span className="text-neutral-600 text-xs"> MON</span>
            </p>
            <p className={`text-xs font-medium ${isPriceUp ? 'text-emerald-500' : 'text-red-500'}`}>
              {isPriceUp ? '+' : ''}{priceChange.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Total Invested */}
        <div className="stat-card">
          <p className="stat-label">Invested</p>
          <p className="stat-value">${agent.total_invested.toFixed(2)}</p>
        </div>
      </div>

      {/* Invest Button */}
      <Button
        variant="primary"
        fullWidth
        disabled={isDead}
        onClick={handleInvest}
      >
        {isDead ? 'Inactive' : 'Invest →'}
      </Button>

      {isDead && (
        <p className="text-xs text-red-500 text-center mt-2 uppercase tracking-wider">
          Agent inactive — no investments accepted
        </p>
      )}
    </div>
  );
}
