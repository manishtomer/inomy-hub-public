import { AgentThinking as AgentThinkingType } from '@/types/ui';

interface AgentThinkingProps {
  thinking: AgentThinkingType[];
}

export function AgentThinking({ thinking }: AgentThinkingProps) {
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffMins < 1) {
      return 'just now';
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else {
      const diffHours = Math.floor(diffMins / 60);
      return `${diffHours}h ago`;
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-cyber-500 font-mono text-sm">{'>'}</span>
        <p className="section-header mb-0">Agent Thinking</p>
      </div>

      {/* Terminal-style thinking box */}
      <div className="border border-cyber-600/50 rounded bg-void p-4 space-y-2">
        {thinking.length === 0 ? (
          <p className="text-xs text-neutral-600 text-center py-4">No recent thoughts</p>
        ) : (
          thinking.map((thought, index) => (
            <div
              key={index}
              className="bg-neutral-900 border border-neutral-800 rounded p-3"
            >
              {/* Thought */}
              <p className="text-xs text-neutral-300 mb-2 font-mono leading-relaxed">
                {thought.thought}
              </p>

              {/* Context and Timestamp */}
              <div className="flex items-center justify-between text-xs">
                {thought.context && (
                  <span className="text-cyber-500 font-medium uppercase tracking-wider">
                    [{thought.context}]
                  </span>
                )}
                <span className="text-neutral-600 ml-auto">
                  {formatTimestamp(thought.timestamp)}
                </span>
              </div>
            </div>
          ))
        )}

        {/* Terminal cursor indicator */}
        <div className="flex items-center gap-2 pt-2 text-xs text-neutral-600">
          <span className="text-cyber-500 animate-blink">▋</span>
          <span className="uppercase tracking-wider">Processing</span>
        </div>
      </div>
    </div>
  );
}
