import { AgentDetail } from '@/types/ui';
import { Badge, getStatusBadgeVariant, getTypeBadgeVariant, getPersonalityBadgeVariant } from '@/components/ui/Badge';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { LiveIndicator } from '@/components/ui/LiveIndicator';

interface AgentDetailHeaderProps {
  agent: AgentDetail;
}

export function AgentDetailHeader({ agent }: AgentDetailHeaderProps) {
  return (
    <div className="flex items-start gap-4">
      {/* Avatar */}
      <AgentAvatar name={agent.name} size={48} />

      {/* Info */}
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-lg font-medium text-neutral-100">{agent.name}</h2>
          {agent.status === 'ACTIVE' && <LiveIndicator />}
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant={getTypeBadgeVariant(agent.type)}>
            {agent.type}
          </Badge>
          <Badge variant={getStatusBadgeVariant(agent.status)}>
            {agent.status}
          </Badge>
          <Badge variant={getPersonalityBadgeVariant(agent.personality)}>
            {agent.personality}
          </Badge>
        </div>
      </div>
    </div>
  );
}
