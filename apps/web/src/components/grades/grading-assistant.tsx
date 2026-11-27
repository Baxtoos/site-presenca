"use client";

import { GRADING_AI_MAX_TURNS, type GradingAssistantResponse } from "@presenca/contracts";
import { type FormEvent, useRef, useState } from "react";
import { Alert, Button, INPUT_CLASS } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import type { EditorDraft } from "./grading-editor";

type Msg = { role: "user" | "assistant"; text: string };

export function GradingAssistant({
  subjectId,
  onDraft,
}: {
  subjectId: string;
  onDraft: (draft: EditorDraft, message: string) => void;
}) {
  const conversationId = useRef(crypto.randomUUID());
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [remaining, setRemaining] = useState(GRADING_AI_MAX_TURNS);
  const [stopped, setStopped] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value || pending) return;
    const next: Msg[] = [...messages, { role: "user", text: value }];
    setMessages(next);
    setText("");
    await ask(next);
  }

  async function ask(next: Msg[]) {
    setFailed(null);
    setPending(true);
    try {
      const res = await api<GradingAssistantResponse>(
        `/v1/subjects/${subjectId}/grading/assistant`,
        {
          method: "POST",
          body: { conversationId: conversationId.current, messages: next },
        },
      );
      if (res.type === "question") {
        setMessages([...next, { role: "assistant", text: res.text }]);
        setRemaining(res.remaining);
      } else if (res.type === "scheme") {
        const done = `${res.summary}\nPreenchi o editor abaixo: confira e salve. Se algo estiver errado, me diga aqui ou ajuste lá.`;
        setMessages([...next, { role: "assistant", text: done }]);
        setRemaining(res.remaining);
        onDraft(res.proposal, "Regra preenchida pelo assistente. Confira antes de salvar.");
      } else if (res.reason === "error" && !res.draft) {
        setFailed(res.message);
      } else {
        setStopped(true);
        onDraft(res.draft, res.message);
      }
    } catch (e) {
      if (e instanceof ApiError && e.problem.status === 429) {
        setStopped(true);
        onDraft(null, "Você usou o assistente muitas vezes hoje. Monte a regra no editor abaixo.");
      } else {
        setFailed("O assistente não respondeu agora. Tente de novo ou use o editor abaixo.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3" data-testid="assistente-notas">
      {messages.length === 0 ? (
        <p className="text-sm text-muted">
          Conte como o professor calcula a nota (ou cole o trecho do plano de ensino) e eu preencho
          o editor abaixo. Se preferir, monte direto nele. Ex.: “Duas provas, a P1 vale 40% e a P2
          60%, passa com 6; quem tira entre 4 e 6 faz exame”.
        </p>
      ) : (
        <ol className="grid gap-2" aria-live="polite">
          {messages.map((m, i) => (
            <li
              key={i}
              className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-accent-soft" : "bg-surface-2"}`}
            >
              <span className="sr-only">{m.role === "user" ? "Você: " : "Assistente: "}</span>
              {m.text}
            </li>
          ))}
        </ol>
      )}
      {failed ? (
        <div className="grid gap-2" data-testid="ia-falhou">
          <Alert>{failed}</Alert>
          <Button
            type="button"
            variant="secondary"
            className="w-fit"
            loading={pending}
            onClick={() => void ask(messages)}
          >
            Tentar de novo
          </Button>
        </div>
      ) : null}
      <form className="grid gap-2" onSubmit={(e) => void send(e)}>
        <label className="sr-only" htmlFor="ia-mensagem">
          Mensagem para o assistente
        </label>
        <textarea
          id="ia-mensagem"
          rows={messages.length === 0 ? 4 : 2}
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            messages.length === 0 ? "Como é calculada a nota desta matéria?" : "Sua resposta"
          }
          className={`${INPUT_CLASS} py-2`}
          disabled={pending || stopped || failed !== null}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            loading={pending}
            disabled={!text.trim() || stopped || failed !== null}
          >
            {messages.length === 0 ? "Enviar" : "Responder"}
          </Button>
          <span className="text-xs text-muted">
            {remaining} de {GRADING_AI_MAX_TURNS} perguntas restantes · o texto vai para a IA do
            Google (Gemini)
          </span>
        </div>
      </form>
    </div>
  );
}
