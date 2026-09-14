import Link from "next/link";

export default function Home() {
  return (
    <>
      <p className="eyebrow">AXIS DIRECT RESEARCH</p>
      <h1>From inbox to evidence.</h1>
      <p className="lead">
        Build an auditable collection of recommendations. Review every extracted
        field before approving it for later research.
      </p>
      <div className="grid">
        <Link className="card" href="/setup">
          <span className="step">01</span>
          <h2>Connect Gmail</h2>
          <p>
            Grant read-only access. Keep credentials encrypted on this computer.
          </p>
        </Link>
        <Link className="card" href="/inbox">
          <span className="step">02</span>
          <h2>Discover & import</h2>
          <p>
            Confirm senders and subject patterns, then select messages to parse.
          </p>
        </Link>
        <Link className="card" href="/review">
          <span className="step">03</span>
          <h2>Review the evidence</h2>
          <p>
            Correct, approve, or reject. Every correction has a version history.
          </p>
        </Link>
      </div>
      <section className="notice">
        Market data and simulations arrive in later phases. This phase imports
        and reviews research only.
      </section>
    </>
  );
}
