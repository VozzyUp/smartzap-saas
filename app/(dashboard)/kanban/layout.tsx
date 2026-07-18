import { PageLayoutScope } from '@/components/providers/PageLayoutProvider'

export default function KanbanLayout({ children }: { children: React.ReactNode }) {
  // Funil precisa de largura cheia (colunas com scroll horizontal) e altura
  // cheia (scroll vertical fica dentro de cada coluna, não na página).
  return (
    <PageLayoutScope
      value={{
        width: 'full',
        padded: true,
        overflow: 'hidden',
        height: 'full',
        showAccountAlerts: true,
      }}
    >
      {children}
    </PageLayoutScope>
  )
}
