import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";
import { ENV, type Env } from "../config/env";

/**
 * Argon2id com os parâmetros mínimos recomendados pela OWASP (19 MiB, 2 iterações, 1 thread).
 * `algorithm: 2` é Algorithm.Argon2id; o enum do pacote é só de declaração (const enum).
 */
const ARGON2_OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  /** Hash de uma senha aleatória: verificar contra ele custa o mesmo que contra uma conta real. */
  private readonly dummyHash: Promise<string>;

  constructor(@Inject(ENV) private readonly env: Pick<Env, "HIBP_ENABLED">) {
    this.dummyHash = hash(randomBytes(32).toString("hex"), ARGON2_OPTIONS);
  }

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  /**
   * Confere a senha. Sem hash (conta inexistente ou só com Google), verifica contra um hash
   * falso: a resposta demora o mesmo e não revela se o e-mail tem conta.
   */
  async verify(storedHash: string | null, password: string): Promise<boolean> {
    if (storedHash === null) {
      await verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await verify(storedHash, password);
    } catch {
      return false;
    }
  }

  /**
   * A senha aparece em vazamentos conhecidos? Consulta o Have I Been Pwned por k-anonimato:
   * só os 5 primeiros caracteres do SHA-1 saem daqui, nunca a senha nem o hash inteiro.
   * Se o serviço não responder, deixa passar (a disponibilidade do cadastro vem primeiro).
   */
  async isBreached(password: string): Promise<boolean> {
    if (!this.env.HIBP_ENABLED) return false;
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { "add-padding": "true", "user-agent": "presenca-api" },
        signal: AbortSignal.timeout(1_500),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      return body.split("\n").some((line) => {
        const [candidate, count] = line.trim().split(":");
        return candidate === suffix && Number(count) > 0;
      });
    } catch (error) {
      this.logger.warn(
        `Have I Been Pwned indisponível (${error instanceof Error ? error.message : String(error)}); senha aceita sem a checagem`,
      );
      return false;
    }
  }
}
