export type PaginationParams = {
  page: number;
  limit: number;
};

export const normalizePagination = (page?: number, limit?: number): PaginationParams => {
  const normalizedPage = !page || page < 1 ? 1 : page;
  let normalizedLimit = !limit || limit < 1 ? 20 : limit;
  normalizedLimit = Math.min(normalizedLimit, 100);
  return {
    page: normalizedPage,
    limit: normalizedLimit,
  };
};

export const buildPaginationClause = ({ page, limit }: PaginationParams) => {
  const offset = (page - 1) * limit;
  return {
    limit,
    offset,
  };
};
