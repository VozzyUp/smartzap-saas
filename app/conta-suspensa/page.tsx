// app/conta-suspensa/page.tsx (server component, fora do shell do dashboard)
export default function ContaSuspensaPage() {
  return (
    <div className="min-h-screen bg-[var(--ds-bg-base)] flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-[var(--ds-text-primary)]">Conta suspensa</h1>
        <p className="text-[var(--ds-text-secondary)] mt-3">
          Sua conta está temporariamente suspensa. Seus dados estão preservados. Fale com a gente para reativar.
        </p>
        <a href="mailto:contato@vozzyup.com.br?subject=Conta%20suspensa%20SmartZap"
           className="inline-block w-full mt-6 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-xl transition-colors">
          Falar com o time
        </a>
      </div>
    </div>
  )
}
