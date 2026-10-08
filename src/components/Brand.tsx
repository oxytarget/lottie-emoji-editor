/** The app's name, shown in the header, the page title and the wallet's connect screen. */
export const APP_NAME = 'MojiMotion';

const logo = (size: number) => `${import.meta.env.BASE_URL}logo-${size}.png`;

/** Logo, name and BETA badge; under them (phones) the section you are in. */
export function Brand({ section, betaTitle }: { section: string; betaTitle: string }) {
  return (
    <div className="brand">
      <img className="brand-logo" src={logo(64)} srcSet={`${logo(64)} 1x, ${logo(128)} 2x, ${logo(256)} 3x`} width={34} height={34} alt="" draggable={false} />
      <span className="brand-text">
        <span className="brand-name">
          {APP_NAME}
          <span className="c-beta" title={betaTitle}>
            BETA
          </span>
        </span>
        <h1 className="brand-section">{section}</h1>
      </span>
    </div>
  );
}
