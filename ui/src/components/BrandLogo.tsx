import logoMark from "../assets/logo-mark-64.png";
import logoWordmarkMark from "../assets/logo-mark-160.png";

interface BrandLogoProps {
  /** The wordmark pairs the mark with the product name; the mark alone is for the cramped title bar. */
  wordmark?: boolean;
}

export function BrandLogo({ wordmark = false }: BrandLogoProps) {
  if (!wordmark) {
    return <img className="brand-mark" src={logoMark} alt="Rebasar" draggable={false} />;
  }
  return (
    <div className="brand-wordmark" role="img" aria-label="Rebasar">
      <img className="brand-wordmark-mark" src={logoWordmarkMark} alt="" draggable={false} />
      <span aria-hidden="true">Rebasar</span>
    </div>
  );
}
