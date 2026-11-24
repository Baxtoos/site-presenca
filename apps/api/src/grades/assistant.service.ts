import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  GRADING_AI_MAX_TURNS,
  type GradingAssistantRequest,
  type GradingAssistantResponse,
  saveGradingBodySchema,
} from "@presenca/contracts";
import { schema } from "@presenca/db";
import { validateGrading } from "@presenca/engine";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { z } from "zod";
import { requestContext } from "../common/request-context";
import { ENV, type Env } from "../config/env";
import { DbService } from "../database/db.service";
import { REDIS } from "../redis/redis.module";

/** Cliente da Anthropic (null sem chave). Trocado por um falso nos testes. */
export const ANTHROPIC_CLIENT = Symbol("ANTHROPIC_CLIENT");
export type AnthropicLike = Pick<Anthropic, "messages">;

export function anthropicClientFactory(env: Env): AnthropicLike | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  // Timeout curto e uma repetição só: se a IA demorar, a tela cai no editor manual.
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 1 });
}

/** Formato que a IA devolve (em pontos, que é como as pessoas falam; a API converte). */
const aiTurnSchema = z.object({
  kind: z.enum(["question", "scheme"]),
  question: z.string().nullable(),
  summary: z.string().nullable(),
  scheme: z
    .object({
      scale: z.union([z.literal(10), z.literal(100)]),
      passing: z.number(),
      formula: z.string(),
      groups: z.array(
        z.object({
          key: z.string(),
          name: z.string(),
          aggregate: z.enum(["mean", "sum"]),
          dropLowest: z.number().int(),
        }),
      ),
      exam: z
        .object({ minToTake: z.number(), formula: z.string(), passing: z.number() })
        .nullable(),
      substitute: z.object({ replaces: z.array(z.string()) }).nullable(),
      roundingStep: z.number(),
      items: z.array(
        z.object({
          key: z.string(),
          name: z.string(),
          maxScore: z.number(),
          group: z.string().nullable(),
          role: z.enum(["regular", "substitute", "exam"]),
        }),
      ),
    })
    .nullable(),
});
type AiTurn = z.infer<typeof aiTurnSchema>;
type Proposal = z.output<typeof saveGradingBodySchema>;

const SYSTEM = `Você ajuda um aluno universitário brasileiro a registrar COMO o professor calcula a nota de uma matéria, para o app Monitor de Presenças fazer as contas. Cada professor calcula de um jeito: nunca suponha uma regra que o aluno não disse. Você só COLETA a regra: não calcule notas, médias nem quanto falta (o app faz as contas).

Converse em português do Brasil, com frases curtas e amigáveis. Faça UMA pergunta por vez, só quando faltar algo essencial: avaliações e pesos, nota máxima de cada uma, nota mínima para passar, exame ou prova final, substitutiva, descarte de listas e arredondamento. Se o aluno colar o plano de ensino, extraia dele.

Quando tiver o suficiente, responda kind="scheme" com:
- scale: 10 ou 100 (escala das notas);
- passing: nota mínima para passar, em pontos (ex.: 6);
- items: as avaliações, com key curta sem espaços (P1, P2, L1, Trabalho, Sub, Exame), name legível, maxScore em pontos e role: "regular" (entra na média), "substitute" (substitutiva) ou "exam" (exame/prova final);
- formula: a média final usando as keys das avaliações regulares e dos grupos, com + - * / ( ) números e as funções max(), min() e media(). Ex.: "0.4*P1 + 0.6*P2", "(2*P1 + 3*P2)/5 + Trabalho";
- groups: para várias atividades parecidas (listas), um grupo com key (ex.: "Listas"), aggregate "mean" ou "sum" e dropLowest (quantas piores descartar); as atividades do grupo levam group = key do grupo, e a fórmula usa a key do grupo;
- exam: se houver exame, minToTake (nota mínima para ter direito, menor que passing), formula usando só MEDIA e EXAME (ex.: "(MEDIA + EXAME)/2") e passing depois do exame; senão null;
- substitute: se houver substitutiva, replaces com as keys que ela pode substituir (troca a menor, se for maior); senão null;
- roundingStep: arredondamento da nota final em pontos (0 = não arredonda, 0.1, 0.5 ou 1);
- summary: a regra em uma ou duas frases, para o aluno conferir.

Responda kind="question" com question preenchida enquanto faltar informação. Se o aluno não souber algum detalhe, use o mais comum no Brasil (mínimo 6 de 10, sem arredondamento) e diga isso no summary.`;

const STEP_FROM_POINTS: Record<string, number> = {
  "0": 1,
  "0.05": 5,
  "0.1": 10,
  "0.25": 25,
  "0.5": 50,
  "1": 100,
};
const centi = (points: number) => Math.max(0, Math.round(points * 100));

/** Regra da IA (em pontos) → formato da API (centésimos). */
function toProposal(s: NonNullable<AiTurn["scheme"]>): Proposal {
  return {
    rules: {
      scale: s.scale,
      passing: centi(s.passing),
      formula: s.formula,
      groups: s.groups.map((g) => ({ ...g, dropLowest: Math.max(0, g.dropLowest) })),
      exam: s.exam
        ? {
            minToTake: centi(s.exam.minToTake),
            formula: s.exam.formula,
            passing: centi(s.exam.passing),
          }
        : null,
      substitute: s.substitute,
      roundingStep: STEP_FROM_POINTS[String(s.roundingStep)] ?? 1,
    },
    items: s.items.map((it) => ({
      key: it.key,
      name: it.name,
      maxScore: centi(it.maxScore),
      group: it.group,
      role: it.role,
      dueOn: null,
    })),
    source: "ai",
  };
}

/** Problemas da proposta (contrato + motor); vazio = pronta para o aluno conferir. */
function problemsOf(proposal: Proposal): string[] {
  const parsed = saveGradingBodySchema.safeParse(proposal);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  return validateGrading(
    parsed.data.rules,
    parsed.data.items.map((i) => ({
      key: i.key,
      name: i.name,
      maxScore: i.maxScore,
      group: i.group,
      role: i.role,
    })),
  ).map((e) => `${e.path}: ${e.message}`);
}

const FALLBACK_MESSAGE = {
  limit:
    "Chegamos ao limite de perguntas. Complete a regra no editor abaixo (já preenchi o que entendi).",
  error: "O assistente não respondeu agora. Use o editor abaixo para montar a regra.",
  unavailable: "O assistente não está ligado neste servidor. Use o editor abaixo.",
} as const;

/**
 * Assistente de notas: conversa com o aluno (Claude Haiku, saída estruturada) só para coletar a
 * regra de cálculo; as contas são do motor (@presenca/engine). No máximo 10 chamadas por conversa (contadas no Redis). Em limite, erro, demora ou
 * recusa, devolve "fallback" e a tela abre o editor manual com o rascunho. Nunca salva sozinho.
 */
@Injectable()
export class GradingAssistantService {
  private readonly model: string;

  constructor(
    private readonly db: DbService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ANTHROPIC_CLIENT) private readonly client: AnthropicLike | null,
    @Inject(ENV) env: Env,
  ) {
    this.model = env.GRADING_AI_MODEL;
  }

  get available(): boolean {
    return this.client !== null;
  }

  async turn(subjectId: string, req: GradingAssistantRequest): Promise<GradingAssistantResponse> {
    const subject = await this.db.tx(async (tx) => {
      const [row] = await tx
        .select({ name: schema.subjects.name })
        .from(schema.subjects)
        .where(eq(schema.subjects.id, subjectId));
      return row;
    });
    if (!subject) throw new NotFoundException({ detail: "Matéria não encontrada." });
    if (!this.client) {
      return {
        type: "fallback",
        reason: "unavailable",
        message: FALLBACK_MESSAGE.unavailable,
        draft: null,
      };
    }

    const userId = requestContext.get()?.userId ?? "anon";
    const counterKey = `grading-ai:${userId}:${req.conversationId}`;
    const nextTurn = async () => {
      const used = await this.redis.incr(counterKey);
      if (used === 1) await this.redis.expire(counterKey, 6 * 3600);
      return used;
    };

    let used = await nextTurn();
    if (used > GRADING_AI_MAX_TURNS) {
      return { type: "fallback", reason: "limit", message: FALLBACK_MESSAGE.limit, draft: null };
    }

    const history: Anthropic.MessageParam[] = req.messages.map((m) => ({
      role: m.role,
      content: m.text,
    }));
    let lastDraft: Proposal | null = null;

    // Até duas chamadas nesta requisição: a resposta e, se a regra vier com problema, um conserto.
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = GRADING_AI_MAX_TURNS - used;
      let turn: AiTurn | null;
      try {
        turn = await this.ask(subject.name, history, remaining);
      } catch {
        return {
          type: "fallback",
          reason: "error",
          message: FALLBACK_MESSAGE.error,
          draft: lastDraft,
        };
      }
      if (!turn) {
        return {
          type: "fallback",
          reason: "error",
          message: FALLBACK_MESSAGE.error,
          draft: lastDraft,
        };
      }
      if (turn.kind === "question" && turn.question) {
        if (remaining <= 0) {
          return {
            type: "fallback",
            reason: "limit",
            message: FALLBACK_MESSAGE.limit,
            draft: lastDraft,
          };
        }
        return { type: "question", text: turn.question, remaining };
      }
      if (!turn.scheme) {
        return {
          type: "fallback",
          reason: "error",
          message: FALLBACK_MESSAGE.error,
          draft: lastDraft,
        };
      }
      const proposal = toProposal(turn.scheme);
      const problems = problemsOf(proposal);
      if (problems.length === 0) {
        return {
          type: "scheme",
          summary: turn.summary ?? "Regra montada. Confira antes de salvar.",
          proposal,
          remaining,
        };
      }
      lastDraft = proposal;
      if (attempt === 1 || remaining <= 0) break;
      // Conserto: mostra os problemas para a IA (conta como mais uma chamada da conversa).
      used = await nextTurn();
      if (used > GRADING_AI_MAX_TURNS) break;
      history.push(
        { role: "assistant", content: JSON.stringify(turn) },
        {
          role: "user",
          content: `O app recusou essa regra:\n- ${problems.slice(0, 8).join("\n- ")}\nCorrija e responda de novo (kind="scheme").`,
        },
      );
    }
    return { type: "fallback", reason: "limit", message: FALLBACK_MESSAGE.limit, draft: lastDraft };
  }

  private async ask(
    subjectName: string,
    messages: Anthropic.MessageParam[],
    remaining: number,
  ): Promise<AiTurn | null> {
    const response = await this.client!.messages.parse({
      model: this.model,
      max_tokens: 4000,
      system: `${SYSTEM}\n\nMatéria: ${subjectName}.\nPerguntas que ainda pode fazer nesta conversa: ${remaining}. Com 0 restantes, responda kind="scheme" com a melhor regra possível.`,
      messages,
      output_config: { format: zodOutputFormat(aiTurnSchema) },
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
    return response.parsed_output ?? null;
  }
}
