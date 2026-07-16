import type { NextFunction, Request, Response } from "express";

/**
 * Express 4's router does not await async handlers, so a rejected promise
 * inside one (e.g. a failed query) becomes an unhandled rejection instead of
 * reaching the error middleware. Wrapping every async route in this forwards
 * the rejection to `next(err)` so the centralised handler in index.ts always
 * catches it.
 */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Req, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
