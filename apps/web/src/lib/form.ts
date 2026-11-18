/** Valor de texto de um campo do formulário ("" se ausente ou se for arquivo). */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
