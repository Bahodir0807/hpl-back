import { DealStage } from '@prisma/client';

// Матрица допустимых переходов стадий сделки (ТЗ 5.5, правила 3–4).
// Только «вперёд по воронке» или LOST из любой активной стадии.
// Нарушение матрицы — не жёсткая ошибка, а violation: руководитель может
// провести исключение через isException + reason + deals:stage_exception.
export const DEAL_STAGE_TRANSITIONS: Record<DealStage, DealStage[]> = {
  [DealStage.QUALIFICATION]: [DealStage.HPL_SELECTION, DealStage.LOST],
  [DealStage.HPL_SELECTION]: [DealStage.OFFER_PREPARATION, DealStage.LOST],
  [DealStage.OFFER_PREPARATION]: [DealStage.NEGOTIATION, DealStage.LOST],
  [DealStage.NEGOTIATION]: [DealStage.AGREEMENT_PENDING, DealStage.LOST],
  [DealStage.AGREEMENT_PENDING]: [
    DealStage.PAYMENT_PREPARATION,
    DealStage.LOST,
  ],
  [DealStage.PAYMENT_PREPARATION]: [DealStage.WON, DealStage.LOST],
  [DealStage.SHIPPED]: [DealStage.WON, DealStage.LOST],
  [DealStage.WON]: [],
  [DealStage.LOST]: [],
};

// Терминальные стадии: выход запрещён без deals:override_terminal и причины.
export const TERMINAL_DEAL_STAGES: DealStage[] = [
  DealStage.WON,
  DealStage.LOST,
];

export const OVERRIDE_TERMINAL_STAGE_PERMISSION = 'deals:override_terminal';
