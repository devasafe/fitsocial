import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Envolve um handler assíncrono e encaminha erros para o middleware de erro,
 * evitando try/catch repetido em cada rota.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
