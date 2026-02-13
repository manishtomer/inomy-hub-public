import { AgentActivity as AgentActivityType } from '@/types/ui';

interface AgentActivityProps {
  activities: AgentActivityType[];
}

export function AgentActivity({ activities }: AgentActivityProps) {
  const getActivityIcon = (type: AgentActivityType['type']) => {
    switch (type) {
      case 'task_completed':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'task_failed':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case 'investment_received':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'status_changed':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        );
      case 'partnership_formed':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        );
    }
  };

  const getStatusColor = (status?: AgentActivityType['status']) => {
    switch (status) {
      case 'success':
        return 'text-emerald-500 bg-neutral-900 border-neutral-700';
      case 'error':
        return 'text-red-500 bg-neutral-900 border-neutral-700';
      case 'warning':
        return 'text-amber-500 bg-neutral-900 border-neutral-700';
      case 'info':
      default:
        return 'text-neutral-400 bg-neutral-900 border-neutral-700';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    }
  };

  return (
    <div>
      <p className="section-header">Recent Activity</p>
      <div className="space-y-2">
        {activities.length === 0 ? (
          <p className="text-xs text-neutral-600 text-center py-4">No recent activity</p>
        ) : (
          activities.map((activity) => (
            <div
              key={activity.id}
              className={`flex items-start gap-3 p-3 rounded border ${getStatusColor(activity.status)}`}
            >
              {/* Icon */}
              <div className="flex-shrink-0 mt-0.5 opacity-60">
                {getActivityIcon(activity.type)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-xs">
                  {activity.description}
                </p>
                <p className="text-xs text-neutral-600 mt-0.5">
                  {formatTimestamp(activity.timestamp)}
                </p>
              </div>

              {/* Amount */}
              {activity.amount !== undefined && (
                <div className="flex-shrink-0">
                  <p className={`text-xs font-mono ${activity.amount >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {activity.amount >= 0 ? '+' : ''}${Math.abs(activity.amount).toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
