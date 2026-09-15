import type { DashboardModel } from "../dashboard.js";

const STATUS_COLORS = {
  completed: "var(--success)",
  live: "var(--info)",
  failed: "var(--danger)",
  cancelled: "var(--text-faint)",
};

export function ActivityChart({
  activity,
}: {
  activity: DashboardModel["activity"];
}) {
  const max = Math.max(1, ...activity.map((bucket) => bucket.total));
  const chartHeight = 116;
  const barWidth = 24;
  const gap = 18;

  return (
    <div className="activity-chart">
      <svg
        viewBox="0 0 520 160"
        role="img"
        aria-label="Executions created during the last six hours"
      >
        <line x1="0" y1="132" x2="520" y2="132" className="chart-baseline" />
        {activity.map((bucket, index) => {
          const x = 10 + index * (barWidth + gap);
          const totalHeight = (bucket.total / max) * chartHeight;
          const completedHeight = (bucket.completed / max) * chartHeight;
          const liveHeight = (bucket.live / max) * chartHeight;
          const failedHeight = (bucket.failed / max) * chartHeight;
          const otherHeight = Math.max(
            0,
            totalHeight - completedHeight - liveHeight - failedHeight,
          );
          let y = 132;
          const segments = [
            { id: "completed", height: completedHeight },
            { id: "live", height: liveHeight },
            { id: "failed", height: failedHeight },
            { id: "other", height: otherHeight },
          ];
          return (
            <g key={`${bucket.label}-${index}`}>
              <title>{`${bucket.label}: ${bucket.total} execution${bucket.total === 1 ? "" : "s"}`}</title>
              <rect
                x={x}
                y={16}
                width={barWidth}
                height={chartHeight}
                rx="5"
                className="chart-track"
              />
              {segments.map((segment) => {
                y -= segment.height;
                return segment.height > 0 ? (
                  <rect
                    key={segment.id}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={segment.height}
                    className={`activity-segment ${segment.id}`}
                  />
                ) : null;
              })}
              {index % 2 === 0 ? (
                <text x={x + barWidth / 2} y="153" textAnchor="middle">
                  {bucket.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend compact">
        <span><i className="legend-dot completed" />Completed</span>
        <span><i className="legend-dot live" />Live</span>
        <span><i className="legend-dot failed" />Failed</span>
      </div>
    </div>
  );
}

export function StatusMixChart({
  statusMix,
}: {
  statusMix: DashboardModel["statusMix"];
}) {
  const total = statusMix.reduce((sum, segment) => sum + segment.count, 0);
  let offset = 0;
  return (
    <div className="status-chart">
      <div className="status-ring-wrap">
        <svg viewBox="0 0 120 120" role="img" aria-label="Execution status mix">
          <circle className="ring-track" cx="60" cy="60" r="46" pathLength="100" />
          {statusMix.map((segment) => {
            const share = total === 0 ? 0 : (segment.count / total) * 100;
            const currentOffset = offset;
            offset += share;
            return share > 0 ? (
              <circle
                key={segment.id}
                className="ring-segment"
                cx="60"
                cy="60"
                r="46"
                pathLength="100"
                stroke={STATUS_COLORS[segment.id]}
                strokeDasharray={`${share} ${100 - share}`}
                strokeDashoffset={-currentOffset}
              >
                <title>{`${segment.label}: ${segment.count}`}</title>
              </circle>
            ) : null;
          })}
        </svg>
        <div className="ring-total">
          <strong>{total}</strong>
          <span>runs</span>
        </div>
      </div>
      <div className="status-legend">
        {statusMix.map((segment) => (
          <div key={segment.id}>
            <span><i className={`legend-dot ${segment.id}`} />{segment.label}</span>
            <strong>{segment.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
