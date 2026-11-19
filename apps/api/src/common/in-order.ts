/**
 * Executa consultas Drizzle uma depois da outra, com o mesmo formato de retorno do Promise.all.
 *
 * Dentro de uma transação todas as consultas usam a mesma conexão: o Postgres as executa em fila de
 * qualquer jeito, e disparar várias juntas gera o aviso de depreciação do pg ("client.query() when
 * the client is already executing a query"), que vira erro no pg@9. As consultas do Drizzle são
 * preguiçosas (só rodam no `await`), então basta aguardá-las na ordem.
 */
export async function inOrder<const T extends readonly PromiseLike<unknown>[]>(
  queries: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results: unknown[] = [];
  for (const query of queries) results.push(await query);
  return results as { -readonly [K in keyof T]: Awaited<T[K]> };
}
