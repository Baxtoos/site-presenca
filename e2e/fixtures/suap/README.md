# Páginas do SUAP para o teste do favorito

Usadas por `e2e/tests/suap.spec.ts`, que finge ser o `suap.ifsp.edu.br` (Playwright intercepta as
requisições) e roda o favorito "Enviar para o Monitor" de verdade.

- `aluno.html`, `boletins.html`, `turma-397554-*.html`: páginas reais do SUAP do IFSP **anonimizadas**
  (sem nome, matrícula, professor, fotos, scripts nem tokens de sessão); só a estrutura das tabelas.
- `turma-397727-*.html`: turma sintética no mesmo formato. A aba "Aulas Ministradas" chega vazia e é
  preenchida por script depois de carregar, como as abas do SUAP, para testar a leitura pelo quadro
  escondido.

Se o SUAP mudar o layout, salve as páginas de novo (aba aberta, console:
`document.documentElement.outerHTML`) e anonimize antes de trocar estes arquivos.
