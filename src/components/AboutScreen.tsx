import './Screens.css';

interface AboutScreenProps {
  safetyMessage: string;
}

export function AboutScreen({ safetyMessage }: AboutScreenProps) {
  return (
    <section className="screen">
      <div className="screen-copy">
        <h1 className="screen-title">Despre aplicație</h1>
        <p className="screen-subtitle">O aplicație simplă pentru exerciții de respirație în 3 faze.</p>
      </div>

      <article className="surface-card">
        <div className="surface-card__title">Siguranță</div>
        <p className="safety-copy">{safetyMessage}</p>
      </article>
    </section>
  );
}