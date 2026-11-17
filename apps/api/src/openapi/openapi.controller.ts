import { Controller, Get, Inject, NotFoundException } from "@nestjs/common";
import { buildOpenApiDocument, routes } from "@presenca/contracts";
import { ENV, type Env } from "../config/env";

@Controller()
export class OpenApiController {
  private readonly document: ReturnType<typeof buildOpenApiDocument>;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.document = buildOpenApiDocument(routes, {
      title: "Monitor de Presenças · API",
      version: env.APP_VERSION,
      description: "API REST do Monitor de Presenças. Erros seguem RFC 9457 (problem+json).",
    });
  }

  /** Documentação OpenAPI 3.1 gerada de packages/contracts. Desligada em produção por padrão. */
  @Get("openapi.json")
  openapi() {
    if (!this.env.OPENAPI_ENABLED) throw new NotFoundException();
    return this.document;
  }
}
