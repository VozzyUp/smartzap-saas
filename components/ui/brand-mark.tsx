/**
 * Marca do V-Smart: dois V empilhados (o de baixo mais claro).
 * Usa currentColor, então herda a cor do texto de quem a envolve.
 */
export function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="96 84 320 332"
      fill="none"
      stroke="currentColor"
      strokeWidth={54}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="140,238 256,372 372,238" strokeOpacity={0.5} />
      <polyline points="140,128 256,262 372,128" />
    </svg>
  )
}
