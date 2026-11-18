import { Inject, Injectable } from "@nestjs/common";
import { type Db, type DbHandle, type Tx, withUser } from "@presenca/db";
import { requestContext } from "../common/request-context";
import { DB } from "./tokens";

/**
 * Porta de entrada para o banco dentro da API.
 * Toda leitura ou escrita de dados do aluno passa por `tx()` ou `asUser()`, que abrem a transação
 * já identificada (app.user_id) — sem isso o RLS não deixa ver nem gravar nada.
 */
@Injectable()
export class DbService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Transação como o usuário autenticado da requisição atual. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const ctx = requestContext.get();
    if (!ctx?.userId) {
      throw new Error("DbService.tx() chamado fora de uma requisição autenticada");
    }
    return withUser(this.handle.db, { userId: ctx.userId, requestId: ctx.requestId }, fn);
  }

  /** Transação como um usuário específico (ex.: no cadastro e no login, antes da sessão existir). */
  asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withUser(this.handle.db, { userId, requestId: requestContext.get()?.requestId }, fn);
  }

  /**
   * Conexão sem contexto de usuário. Só para chamar as funções SECURITY DEFINER de autenticação:
   * qualquer tabela consultada por aqui volta vazia (RLS).
   */
  get unscoped(): Db {
    return this.handle.db;
  }
}
