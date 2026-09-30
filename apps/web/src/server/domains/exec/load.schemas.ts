import { z } from "zod";

/** S11 LOAD-003 查询参数（分页信封口径；api-conventions §4）。 */
export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const loadTestListQuerySchema = z.object({
  ...pageQuery,
  name: z.string().max(128).optional(),
});

export const loadTaskListQuerySchema = z.object({
  ...pageQuery,
  loadTestId: z.string().uuid().optional(),
});

export const uiElementListQuerySchema = z.object({
  ...pageQuery,
  name: z.string().max(128).optional(),
});

export const uiCaseListQuerySchema = z.object({
  ...pageQuery,
  name: z.string().max(128).optional(),
});
