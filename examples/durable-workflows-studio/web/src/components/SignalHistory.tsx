import type { StudioSignalJournal } from "../../../src/shared/types.js";
import { formatDateTime } from "../format.js";
import { JsonView } from "./JsonView.js";

export function SignalHistory({
  journals,
}: {
  journals: StudioSignalJournal[];
}) {
  const records = journals.flatMap((journal) => journal.history);
  const queued = records.filter((record) => record.state === "queued").length;

  return (
    <section className="signals-view">
      <div className="inspection-summary">
        <div>
          <span className="eyebrow">Signal journal</span>
          <h3>What arrived, and what the workflow consumed</h3>
        </div>
        <div className="signal-totals">
          <span><strong>{records.length}</strong> delivered</span>
          <span><strong>{queued}</strong> queued</span>
          <span><strong>{records.length - queued}</strong> consumed</span>
        </div>
      </div>
      {journals.length === 0 ? (
        <p className="inspection-empty">
          No signals have reached this execution yet.
        </p>
      ) : (
        <div className="signal-journals">
          {journals.map((journal) => (
            <section key={journal.signalId} className="signal-journal">
              <header>
                <div>
                  <span className="signal-dot" aria-hidden="true" />
                  <code>{journal.signalId}</code>
                </div>
                <span>{journal.history.length} records</span>
              </header>
              <ol>
                {[...journal.history].reverse().map((record) => (
                  <li key={record.id}>
                    <div className="signal-record-head">
                      <span className={`signal-state ${record.state}`}>
                        {record.state}
                      </span>
                      <time>{formatDateTime(record.receivedAt)}</time>
                    </div>
                    <JsonView value={record.payload} collapsed label="payload" />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
