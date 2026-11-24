'use client'

import React from 'react'
import { Loader2 } from 'lucide-react'
import { Container } from '@/components/ui/container'

interface StepNavigationProps {
  step: number
  setStep: React.Dispatch<React.SetStateAction<number>>
  canContinue: boolean
  isConfigComplete: boolean
  isContentComplete: boolean
  isButtonsValid: boolean
  onFinish?: () => void
  isFinishing?: boolean
  onSaveDraft?: () => void
  isSaving?: boolean
  showDebug: boolean
  setShowDebug: React.Dispatch<React.SetStateAction<boolean>>
  // Validation states for messages
  isHeaderFormatValid: boolean
  isHeaderVariableValid: boolean
  hasInvalidNamed: boolean
  hasDuplicateNamed: boolean
  hasMissingPositional: boolean
  hasInvalidPositional: boolean
  footerHasVariables: boolean
  headerEdgeParameter: { starts: boolean; ends: boolean }
  bodyEdgeParameter: { starts: boolean; ends: boolean }
  hasLengthErrors: boolean
  ltoHeaderInvalid: boolean
  ltoFooterInvalid: boolean
  buttonErrors: string[]
  carouselErrors: string[]
  limitedTimeOfferCategoryInvalid: boolean
  limitedTimeOfferTextTooLong: boolean
  ltoCopyCodeMissing: boolean
  ltoCopyCodeTooLong: boolean
}

export function StepNavigation({
  step,
  setStep,
  canContinue,
  isConfigComplete,
  isContentComplete,
  isButtonsValid,
  onFinish,
  isFinishing,
  onSaveDraft,
  isSaving,
  showDebug,
  setShowDebug,
  isHeaderFormatValid,
  isHeaderVariableValid,
  hasInvalidNamed,
  hasDuplicateNamed,
  hasMissingPositional,
  hasInvalidPositional,
  footerHasVariables,
  headerEdgeParameter,
  bodyEdgeParameter,
  hasLengthErrors,
  ltoHeaderInvalid,
  ltoFooterInvalid,
  buttonErrors,
  carouselErrors,
  limitedTimeOfferCategoryInvalid,
  limitedTimeOfferTextTooLong,
  ltoCopyCodeMissing,
  ltoCopyCodeTooLong,
}: StepNavigationProps) {
  return (
    <Container variant="default" padding="none" className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-3 md:flex-nowrap md:justify-between">
        <button
          type="button"
          onClick={() => setStep((prev) => Math.max(1, prev - 1))}
          disabled={step === 1}
          className={`inline-flex min-h-11 items-center px-2 text-sm transition ${step === 1 ? 'text-[var(--ds-text-disabled)] cursor-not-allowed' : 'text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)]'}`}
        >
          Voltar
        </button>
        <div className="order-first w-full text-center text-xs text-[var(--ds-text-muted)] empty:hidden md:order-none md:w-auto">
          {step === 1 && !isConfigComplete && 'Complete a configuracao para continuar'}
          {step === 2 && !isContentComplete && (
            !isHeaderFormatValid
              ? 'Tipo de cabecalho invalido'
              : !isHeaderVariableValid
                ? 'Cabecalho permite apenas 1 variavel'
                : hasInvalidNamed
                  ? 'Corrija as variaveis: use minusculas e underscore'
                : hasDuplicateNamed
                  ? 'Nomes de variavel devem ser unicos'
                : hasMissingPositional
                  ? 'Sequencia posicional deve comecar em {{1}} e nao ter buracos'
                : hasInvalidPositional
                  ? 'No modo numerico, use apenas {{1}}, {{2}}...'
                : footerHasVariables
                  ? 'Rodape nao permite variaveis'
                : headerEdgeParameter.starts || headerEdgeParameter.ends
                  ? 'O cabecalho nao pode comecar nem terminar com variavel'
                : bodyEdgeParameter.starts || bodyEdgeParameter.ends
                  ? 'O corpo nao pode comecar nem terminar com variavel'
                : hasLengthErrors
                  ? 'Revise os limites de caracteres'
                : ltoHeaderInvalid
                  ? 'LTO aceita apenas cabecalho imagem/video'
                : ltoFooterInvalid
                  ? 'LTO nao permite rodape'
                : 'Preencha o corpo do template para continuar'
          )}
          {step === 3 && (
            isButtonsValid
              ? 'Reveja os botoes e envie para aprovacao'
              : buttonErrors.length
                ? 'Revise as regras dos botoes'
                : carouselErrors.length
                  ? 'Revise o carousel'
                  : limitedTimeOfferCategoryInvalid
                    ? 'LTO so e permitido em Marketing'
                    : limitedTimeOfferTextTooLong || ltoCopyCodeMissing || ltoCopyCodeTooLong || ltoHeaderInvalid || ltoFooterInvalid
                      ? 'Revise o Limited Time Offer'
                      : 'Revise as regras do template'
          )}
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 md:flex-none">
          {/* Botao Salvar Rascunho */}
          {onSaveDraft && (
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={isSaving || isFinishing}
              className="min-h-11 rounded-full px-4 py-2 text-sm font-medium border border-[var(--ds-border-default)] bg-[var(--ds-bg-elevated)] text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Salvando...
                </span>
              ) : (
                'Salvar Rascunho'
              )}
            </button>
          )}

          {/* Botao Continuar/Enviar */}
          <button
            type="button"
            onClick={() => {
              if (!canContinue || isFinishing) return
              if (step < 3) {
                setStep((prev) => Math.min(3, prev + 1))
                return
              }
              // Ultimo passo: delega a acao ao pai (ex.: salvar + enviar)
              onFinish?.()
            }}
            disabled={!canContinue || !!isFinishing}
            className={`min-h-11 flex-1 sm:flex-none rounded-full px-5 py-2 text-sm font-semibold transition ${
              !isFinishing && canContinue
                ? 'bg-primary-600 text-white dark:bg-white dark:text-black hover:bg-primary-500 dark:hover:bg-gray-200'
                : 'cursor-not-allowed border border-[var(--ds-border-default)] bg-[var(--ds-bg-elevated)] text-[var(--ds-text-muted)]'
            }`}
          >
            {step < 3 ? (
              'Continuar'
            ) : isFinishing ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Enviando pra Meta...
              </span>
            ) : (
              (onFinish ? 'Enviar pra Meta' : 'Fim')
            )}
          </button>
        </div>
      </div>
    </Container>
  )
}
